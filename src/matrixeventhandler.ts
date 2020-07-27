/*
Copyright 2020 mx-puppet-bridge
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Log } from "./log";
import { PuppetBridge } from "./puppetbridge";
import {
	MembershipEvent, RedactionEvent, RoomEvent, MessageEvent, FileMessageEventContent, TextualMessageEventContent,
	MembershipEventContent, RoomEventContent, MessageEventContent, MatrixClient,
} from "@sorunome/matrix-bot-sdk";
import {
	IFileEvent, IMessageEvent, IRemoteRoom, ISendingUser, IRemoteUser, IReplyEvent, IEventInfo,
} from "./interfaces";
import * as escapeHtml from "escape-html";
import { IPuppet } from "./db/puppetstore";

const log = new Log("MatrixEventHandler");

// tslint:disable no-magic-numbers
const GHOST_PUPPET_LEAVE_TIMEOUT = 1000 * 60 * 60;
const AVATAR_SIZE = 800;
// tslint:enable no-magic-numbers

export class MatrixEventHandler {
	private memberInfoCache: { [roomId: string]: { [userId: string]: MembershipEventContent } };

	constructor(
		private bridge: PuppetBridge,
	) {
		this.memberInfoCache = {};
	}

	public registerAppserviceEvents() {
		// tslint:disable-next-line no-any
		this.bridge.AS.on("room.event", async (roomId: string, rawEvent: any) => {
			try {
				await this.handleRoomEvent(roomId, new RoomEvent<RoomEventContent>(rawEvent));
			} catch (err) {
				log.error("Error handling appservice room.event", err.error || err.body || err);
			}
		});
		// tslint:disable-next-line no-any
		this.bridge.AS.on("room.invite", async (roomId: string, rawEvent: any) => {
			try {
				await this.handleInviteEvent(roomId, new MembershipEvent(rawEvent));
			} catch (err) {
				log.error("Error handling appservice room.invite", err.error || err.body || err);
			}
		});
		// tslint:disable-next-line no-any
		this.bridge.AS.on("query.room", async (alias: string, createRoom: any) => {
			try {
				await this.handleRoomQuery(alias, createRoom);
			} catch (err) {
				log.error("Error handling appservice query.room", err.error || err.body || err);
			}
		});
	}

	public async getEventInfo(
		roomId: string,
		eventId: string,
		client?: MatrixClient | null,
		sender?: string,
	): Promise<IEventInfo | null> {
		try {
			if (!client) {
				client = await this.bridge.roomSync.getRoomOp(roomId);
			}
			if (!client) {
				log.error(`Failed fetching event in room ${roomId}: no client`);
				return null;
			}
			const rawEvent = await client.getEvent(roomId, eventId);
			if (!rawEvent) {
				return null;
			}
			const evt = new MessageEvent<MessageEventContent>(rawEvent);

			const info: IEventInfo = {
				user: (await this.getSendingUser(true, roomId, evt.sender, sender))!,
				event: evt,
			};
			if (["m.file", "m.image", "m.audio", "m.sticker", "m.video"].includes(this.getMessageType(evt))) {
				// file event
				const replyEvent = new MessageEvent<FileMessageEventContent>(evt.raw);
				info.event = replyEvent;
				info.file = this.getFileEventData(replyEvent);
			} else {
				// message event
				const replyEvent = new MessageEvent<TextualMessageEventContent>(evt.raw);
				info.event = replyEvent;
				info.message = this.getMessageEventData(replyEvent);
			}
			return info;
		} catch (err) {
			log.error(`Event ${eventId} in room ${roomId} not found`, err.error || err.body || err);
			return null;
		}
	}

	private async handleRoomEvent(roomId: string, event: RoomEvent<RoomEventContent>) {
		if (event.type === "m.room.member") {
			const membershipEvent = new MembershipEvent(event.raw);
			switch (membershipEvent.membership) {
				case "join":
					await this.handleJoinEvent(roomId, membershipEvent);
					return;
				case "ban":
				case "leave":
					await this.handleLeaveEvent(roomId, membershipEvent);
					return;
			}
			return;
		}
		if (event.type === "m.room.redaction") {
			const evt = new RedactionEvent(event.raw);
			await this.handleRedactEvent(roomId, evt);
			return;
		}
		// we handle stickers and reactions as message events
		if (["m.reaction", "m.sticker", "m.room.message"].includes(event.type)) {
			const evt = new MessageEvent<MessageEventContent>(event.raw);
			await this.handleMessageEvent(roomId, evt);
			return;
		}
	}

	private async handleJoinEvent(roomId: string, event: MembershipEvent) {
		const userId = event.membershipFor;
		if (this.bridge.AS.isNamespacedUser(userId)) {
			await this.handleGhostJoinEvent(roomId, event);
		} else {
			await this.handleUserJoinEvent(roomId, event);
		}
	}

	private async handleGhostJoinEvent(roomId: string, event: MembershipEvent) {
		// if we were already membership "join" we just changed avatar / displayname
		if ((event.raw.prev_content. || event.unsigned.prev_content || {}).membership === "join") {
			return;
		}
		const ghostId = event.membershipFor;
		log.info(`Got new ghost join event from ${ghostId} in ${roomId}...`);
		// we CAN'T check for if the room exists here, as if we create a new room
		// the m.room.member event triggers before the room is incerted into the store
		log.verbose("Adding ghost to room cache");
		await this.bridge.puppetStore.joinGhostToRoom(ghostId, roomId);

		this.bridge.presenceHandler.setStatusInRoom(ghostId, roomId);

		// apply room-specific overrides, if present
		// as we use these parts only for setting the room overrides, which translate back to -1 anyways
		// we do not need to go via the namespace handler
		const ghostParts = this.bridge.userSync.getPartsFromMxid(ghostId);
		const roomParts = await this.bridge.roomSync.getPartsFromMxid(roomId);
		log.verbose("Ghost parts:", ghostParts);
		log.verbose("Room parts:", roomParts);
		if (ghostParts && roomParts && roomParts.puppetId === ghostParts.puppetId) {
			log.verbose("Maybe applying room overrides");
			await this.bridge.userSync.setRoomOverride(ghostParts, roomParts.roomId);
		}

		// maybe remove the bot user, if it is present and we are in a direct message room
		if (roomParts) {
			const room = await this.bridge.roomSync.maybeGet(roomParts);
			if (room && room.isDirect) {
				await this.bridge.roomSync.maybeLeaveGhost(roomId, this.bridge.AS.botIntent.userId);
			}
		}
	}

	private async handleUserJoinEvent(roomId: string, event: MembershipEvent) {
		const userId = event.membershipFor;
		log.info(`Got new user join event from ${userId} in ${roomId}...`);
		const room = await this.getRoomParts(roomId, event.sender);
		if (!room) {
			log.verbose("Room not found, ignoring...");
			return; // this isn't a room we handle, just ignore it
		}
		// okay, let's update the member info cache
		this.updateCachedRoomMemberInfo(roomId, userId, event.content);
		const puppetMxid = await this.bridge.provisioner.getMxid(room.puppetId);
		if (userId !== puppetMxid) {
			log.verbose("Room membership change wasn't the puppet, ignoring...");
			return; // it wasn't us
		}
		log.verbose(`Received profile change for ${puppetMxid}`);
		const puppet = await this.bridge.puppetStore.getOrCreateMxidInfo(puppetMxid);
		const newName = event.content.displayname || "";
		const newAvatarMxc = event.content.avatar_url || "";
		let update = false;
		if (newName !== puppet.name) {
			const puppets = await this.bridge.provisioner.getForMxid(puppetMxid);
			for (const p of puppets) {
				log.verbose("Emitting puppetName event...");
				this.bridge.emit("puppetName", p.puppetId, newName);
			}
			puppet.name = newName;
			update = true;
		}
		if (newAvatarMxc !== puppet.avatarMxc) {
			const url = this.bridge.getUrlFromMxc(newAvatarMxc, AVATAR_SIZE, AVATAR_SIZE, "scale");
			const puppets = await this.bridge.provisioner.getForMxid(puppetMxid);
			for (const p of puppets) {
				log.verbose("Emitting puppetAvatar event...");
				this.bridge.emit("puppetAvatar", p.puppetId, url, newAvatarMxc);
			}
			puppet.avatarMxc = newAvatarMxc;
			update = true;
		}
		if (update) {
			await this.bridge.puppetStore.setMxidInfo(puppet);
		}
	}

	private async handleLeaveEvent(roomId: string, event: MembershipEvent) {
		const userId = event.membershipFor;
		log.info(`Got leave event from ${userId} in ${roomId}`);
		if (this.bridge.AS.isNamespacedUser(userId)) {
			log.verbose("Is a ghost, removing from room cache...");
			await this.bridge.puppetStore.leaveGhostFromRoom(userId, roomId);
			return;
		}
	}

	private async handleRedactEvent(roomId: string, event: RedactionEvent) {
		log.info(`Got new redact from ${event.sender} in ${roomId}...`);
		if (this.bridge.AS.isNamespacedUser(event.sender)) {
			log.verbose("It was our own redact, ignoring...");
			return; // we don't handle things from our own namespace
		}
		const room = await this.getRoomParts(roomId, event.sender);
		if (!room) {
			log.verbose("Room not found, ignoring...");
			return;
		}
		const puppetData = await this.bridge.provisioner.get(room.puppetId);
		if (!puppetData) {
			log.error("Puppet not found. Something is REALLY wrong!!!!");
			return;
		}
		const puppetMxid = puppetData.puppetMxid;
		if (puppetData.type === "relay") {
			if (!this.bridge.provisioner.canRelay(event.sender)) {
				log.verbose("Redact wasn't from a relay-able person, ignoring...");
				return;
			}
		} else if (event.sender !== puppetMxid) {
			log.verbose("Redact wasn't by the pupperted user, ignoring...");
			return; // this isn't our puppeted user, so let's not do anything
		}
		// tslint:disable-next-line no-any
		if ((event.content as any).source === this.bridge.protocol.id) {
			log.verbose("Dropping event due to de-duping...");
			return;
		}
		const asUser = await this.getSendingUser(puppetData, roomId, event.sender);
		// handle reation redactions
		if (puppetData.type !== "relay" || this.bridge.protocol.features.advancedRelay) {
			await this.bridge.reactionHandler.handleRedactEvent(room, event, asUser);
		}
		for (const redacts of event.redactsEventIds) {
			const eventIds = await this.bridge.eventSync.getRemote(room, redacts);
			for (const eventId of eventIds) {
				log.verbose("Emitting redact event...");
				this.bridge.emit("redact", room, eventId, asUser, event);
			}
		}
	}

	private async handleMessageEvent(roomId: string, event: MessageEvent<MessageEventContent>) {
		if (this.bridge.AS.isNamespacedUser(event.sender)) {
			return; // we don't handle things from our own namespace
		}
		const room = await this.getRoomParts(roomId, event.sender);
		if (!room) {
			// this isn't a room we handle....so let's do provisioning!
			await this.bridge.botProvisioner.processEvent(roomId, event);
			return;
		}
		log.info(`Got new message in ${roomId} from ${event.sender}!`);
		const puppetData = await this.bridge.provisioner.get(room.puppetId);
		if (!puppetData) {
			log.error("Puppet not found. Something is REALLY wrong!!!!");
			return;
		}
		const puppetMxid = puppetData.puppetMxid;

		// check if we should bridge this room and/or if to apply relay formatting
		if (puppetData.type === "relay") {
			if (!this.bridge.provisioner.canRelay(event.sender)) {
				log.verbose("Message wasn't sent from a relay-able person, dropping...");
				return;
			}
			if (!this.bridge.protocol.features.advancedRelay) {
				await this.applyRelayFormatting(roomId, event.sender, event.content);
			}
		} else if (event.sender !== puppetMxid) {
			log.verbose("Message wasn't sent from the correct puppet, dropping...");
			return;
		}

		// maybe trigger a leave for our ghost puppet in the room
		const ghostMxid = await this.bridge.getMxidForUser({
			userId: puppetData ? puppetData.userId || "" : "",
			puppetId: room.puppetId,
		}, false);
		const delayedKey = `${ghostMxid}_${roomId}`;
		this.bridge.delayedFunction.set(delayedKey, async () => {
			await this.bridge.roomSync.maybeLeaveGhost(roomId, ghostMxid);
		}, GHOST_PUPPET_LEAVE_TIMEOUT, false);

		// we use a custom property "source" on the content
		// tslint:disable-next-line no-any
		if ((event.content as any).source === this.bridge.protocol.id) {
			log.verbose("Dropping event due to de-duping...");
			return;
		}

		const msgtype = this.getMessageType(event);
		if (msgtype === "m.text" && event.textBody.startsWith(`!${this.bridge.protocol.id} `)) {
			await this.bridge.botProvisioner.processRoomEvent(roomId, event);
			return;
		}

		// alright, let's register, that this channel is used!
		// while, in theory, we would also need to do this for redactions or thelike
		// it seems to be sufficient to do it here.
		// we an do this in the background, so no need to await here
		// tslint:disable-next-line no-floating-promises
		this.bridge.roomSync.markAsUsed(room);

		if (["m.file", "m.image", "m.audio", "m.sticker", "m.video"].includes(msgtype)) {
			await this.handleFileEvent(roomId, room, puppetData, new MessageEvent<FileMessageEventContent>(event.raw));
		} else {
			await this.handleTextEvent(roomId, room, puppetData, new MessageEvent<TextualMessageEventContent>(event.raw));
		}
	}

	private getFileEventData(event: MessageEvent<FileMessageEventContent>): IFileEvent {
		const msgtype = this.getMessageType(event);
		const content = event.content;
		const url = this.bridge.getUrlFromMxc(content.url);
		const data: IFileEvent = {
			filename: content.body || "",
			mxc: content.url,
			url,
			eventId: event.eventId,
			type: "file",
		};
		if (content.info) {
			data.info = content.info;
		}
		data.type = {
			"m.image": "image",
			"m.audio": "audio",
			"m.video": "video",
			"m.sticker": "sticker",
		}[msgtype];
		if (!data.type) {
			data.type = "file";
		}
		return data;
	}

	private async handleFileEvent(
		roomId: string,
		room: IRemoteRoom,
		puppetData: IPuppet,
		event: MessageEvent<FileMessageEventContent>,
	) {
		const msgtype = this.getMessageType(event);
		log.info(`Handling file event with msgtype ${msgtype}...`);
		const data = this.getFileEventData(event);
		const emitEvent = data.type;
		const asUser = await this.getSendingUser(puppetData, roomId, event.sender);
		// alright, now determine fallbacks etc.
		if (this.bridge.protocol.features[emitEvent]) {
			log.debug(`Emitting as ${emitEvent}...`);
			this.bridge.emit(emitEvent, room, data, asUser, event);
			return;
		}
		// send stickers as images
		if (emitEvent === "sticker" && this.bridge.protocol.features.image) {
			log.debug("Emitting as image...");
			this.bridge.emit("image", room, data, asUser, event);
			return;
		}
		// and finally send anything as file
		if (this.bridge.protocol.features.file) {
			log.debug("Emitting as file...");
			this.bridge.emit("file", room, data, asUser, event);
			return;
		}
		// okay, we need a fallback to sending text
		log.debug("Emitting as text fallback...");
		const textData: IMessageEvent = {
			body: `New ${emitEvent}: ${data.url}`,
			emote: false,
			eventId: event.eventId,
		};
		this.bridge.emit("message", room, textData, asUser, event);
	}

	private getMessageEventData(event: MessageEvent<TextualMessageEventContent>): IMessageEvent {
		const msgtype = this.getMessageType(event);
		const content = event.content;
		const msgData: IMessageEvent = {
			body: content.body || "",
			emote: msgtype === "m.emote",
			notice: msgtype === "m.notice",
			eventId: event.eventId,
		};
		if (content.format) {
			msgData.formattedBody = content.formatted_body;
		}
		return msgData;
	}

	private async handleTextEvent(
		roomId: string,
		room: IRemoteRoom,
		puppetData: IPuppet,
		event: MessageEvent<TextualMessageEventContent>,
	) {
		const msgtype = this.getMessageType(event);
		log.info(`Handling text event with msgtype ${msgtype}...`);
		const msgData = this.getMessageEventData(event);
		const relate = event.content["m.relates_to"]; // there is no relates_to interface yet :[
		const asUser = await this.getSendingUser(puppetData, roomId, event.sender);
		if (relate) {
			// it only makes sense to process with relation if it is associated with a remote id
			const eventId = relate.event_id || relate["m.in_reply_to"].event_id;
			const relEvent = (await this.bridge.eventSync.getRemote(room,
				eventId))[0];
			if (relEvent) {
				if (this.bridge.protocol.features.edit && relate.rel_type === "m.replace") {
					const newContent: TextualMessageEventContent = event.content["m.new_content"];
					const relData: IMessageEvent = {
						body: newContent.body,
						emote: newContent.msgtype === "m.emote",
						notice: newContent.msgtype === "m.notice",
						eventId: event.eventId,
					};
					if (newContent.format) {
						relData.formattedBody = newContent.formatted_body;
					}
					log.debug("Emitting edit event...");
					this.bridge.emit("edit", room, relEvent, relData, asUser, event);
					return;
				}
				if (this.bridge.protocol.features.reply && (relate.rel_type === "m.in_reply_to" || relate["m.in_reply_to"])) {
					// okay, let's try to fetch the original event
					const info = await this.getEventInfo(roomId, eventId, null, event.sender);
					if (info) {
						const replyData: IReplyEvent = Object.assign(msgData, {
							reply: info,
						});
						log.debug("Emitting reply event...");
						this.bridge.emit("reply", room, relEvent, replyData, asUser, event);
						return;
					}
				}
				if (relate.rel_type === "m.annotation") {
					// no feature setting as reactions are hidden if they aren't supported
					if (puppetData.type !== "relay" || this.bridge.protocol.features.advancedRelay) {
						await this.bridge.reactionHandler.addMatrix(room, relEvent, event.eventId, relate.key);
						log.debug("Emitting reaction event...");
						this.bridge.emit("reaction", room, relEvent, relate.key, asUser, event);
					}
					return;
				}
			}
		}
		if (msgtype === "m.reaction") {
			return; // short-circuit these out, even if they were invalid
		}
		log.debug("Emitting message event...");
		this.bridge.emit("message", room, msgData, asUser, event);
	}

	private async handleInviteEvent(roomId: string, invite: MembershipEvent) {
		const userId = invite.membershipFor;
		const inviteId = invite.sender;
		log.info(`Got invite event in ${roomId} (${inviteId} --> ${userId})`);
		if (userId === this.bridge.AS.botIntent.userId) {
			log.verbose("Bridge bot got invited, joining....");
			await this.bridge.AS.botIntent.joinRoom(roomId);
			return;
		}
		if (!this.bridge.AS.isNamespacedUser(userId)) {
			log.verbose("Our ghost didn't get invited, ignoring...");
			return; // we are only handling ghost invites
		}
		if (this.bridge.AS.isNamespacedUser(inviteId)) {
			log.verbose("Our bridge itself did the invite, ignoring...");
			return; // our bridge did the invite, ignore additional handling
		}
		// as we only check for existance, no need to go via the namespaceHandler --> a bit quicker
		const roomPartsExist = await this.bridge.roomSync.getPartsFromMxid(roomId);
		if (roomPartsExist) {
			log.verbose("Room already exists, so double-puppet user probably auto-invited, ignoring...");
			return; // we are an existing room, meaning a double-puppeted user probably auto-invited. Do nothing
		}
		// alright, this is a valid invite. Let's process it and maybe make a new DM!
		log.info(`Processing invite for ${userId} by ${inviteId}`);
		const intent = this.bridge.AS.getIntentForUserId(userId);
		if (!this.bridge.hooks.getDmRoomId || !this.bridge.hooks.createRoom) {
			log.verbose("Necessary hooks unset, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// check if the mxid validates
		const parts = await this.getUserParts(userId, inviteId);
		if (!parts) {
			log.verbose("invalid mxid, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// check if we actually own that puppet
		const puppet = await this.bridge.provisioner.get(parts.puppetId);
		if (!puppet || puppet.puppetMxid !== inviteId) {
			log.verbose("We don't own that puppet, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// fetch new room id
		const newRoomId = await this.bridge.hooks.getDmRoomId(parts);
		if (!newRoomId) {
			log.verbose("No DM room for this user found, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// check if it already exists
		const roomExists = await this.bridge.roomSync.maybeGet({
			puppetId: parts.puppetId,
			roomId: newRoomId,
		});
		if (roomExists) {
			log.verbose("DM room with this user already exists, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// check if it is a direct room
		const roomData = await this.bridge.hooks.createRoom({
			puppetId: parts.puppetId,
			roomId: newRoomId,
		});
		if (!roomData || roomData.puppetId !== parts.puppetId || roomData.roomId !== newRoomId || !roomData.isDirect) {
			log.verbose("Invalid room creation data, rejecting invite...");
			await intent.leaveRoom(roomId);
			return;
		}
		// FINALLY join back and accept the invite
		log.verbose("All seems fine, creating DM and joining invite!");
		await this.bridge.roomSync.insert(roomId, roomData);
		await this.bridge.roomSync.markAsDirect(roomData);
		await intent.joinRoom(roomId);
		await this.bridge.userSync.getClient(parts); // create user, if it doesn't exist
	}

	// tslint:disable-next-line no-any
	private async handleRoomQuery(alias: string, createRoom: any) {
		log.info(`Got room query for alias ${alias}`);
		// we deny room creation and then create it later on ourself
		await createRoom(false);

		// get room ID and check if it is valid
		// TODO: figure this out
		const parts = await this.bridge.roomSync.getPartsFromMxid(alias);
		if (!parts) {
			return;
		}

		await this.bridge.bridgeRoom(parts);
	}

	private getRoomDisplaynameCache(roomId: string): { [userId: string]: MembershipEventContent } {
		if (!(roomId in this.memberInfoCache)) {
			this.memberInfoCache[roomId] = {};
		}
		return this.memberInfoCache[roomId];
	}

	private updateCachedRoomMemberInfo(roomId: string, userId: string, memberInfo: MembershipEventContent) {
		// we need to clone this object as to not modify the original
		const setInfo = Object.assign({}, memberInfo) as MembershipEventContent;
		if (!setInfo.displayname) {
			// Set localpart as displayname if no displayname is set
			setInfo.displayname = userId.substr(1).split(":")[0];
		}
		this.getRoomDisplaynameCache(roomId)[userId] = setInfo;
	}

	private async getRoomMemberInfo(roomId: string, userId: string): Promise<MembershipEventContent> {
		const roomDisplaynameCache = this.getRoomDisplaynameCache(roomId);
		if (userId in roomDisplaynameCache) {
			return roomDisplaynameCache[userId];
		}
		const client = await this.bridge.roomSync.getRoomOp(roomId) || this.bridge.AS.botClient;
		const memberInfo = (await client.getRoomStateEvent(roomId, "m.room.member", userId)) as MembershipEventContent;
		this.updateCachedRoomMemberInfo(roomId, userId, memberInfo);
		return memberInfo;
	}

	// we need the content to be any-type here, as the textual event content doesn't do m.new_content yet
	// tslint:disable-next-line no-any
	private async applyRelayFormatting(roomId: string, sender: string, content: any) {
		if (content["m.new_content"]) {
			await this.applyRelayFormatting(roomId, sender, content["m.new_content"]);
		}
		const member = await this.getRoomMemberInfo(roomId, sender);
		const displaynameEscaped = escapeHtml(member.displayname);
		if (content.msgtype === "m.text" || content.msgtype === "m.notice") {
			const formattedBody = content.formatted_body || escapeHtml(content.body).replace("\n", "<br>");
			content.formatted_body = `<strong>${displaynameEscaped}</strong>: ${formattedBody}`;
			content.format = "org.matrix.custom.html";
			content.body = `${member.displayname}: ${content.body}`;
		} else if (content.msgtype === "m.emote" ) {
			const formattedBody = content.formatted_body || escapeHtml(content.body).replace("\n", "<br>");
			content.msgtype = "m.text";
			content.formatted_body = `*<strong>${displaynameEscaped}</strong> ${formattedBody}`;
			content.format = "org.matrix.custom.html";
			content.body = `*${member.displayname} ${content.body}`;
		} else {
			const typeMap = {
				"m.image": "an image",
				"m.file": "a file",
				"m.video": "a video",
				"m.sticker": "a sticker",
				"m.audio": "an audio file",
			};
			const url = this.bridge.getUrlFromMxc(content.url);
			delete content.url;
			const msg = typeMap[content.msgtype];
			const escapeUrl = escapeHtml(url);
			const filename = content.body;
			content.body = `${member.displayname} sent ${msg} ${filename}: ${url}`;
			content.msgtype = "m.text";
			content.format = "org.matrix.custom.html";
			content.formatted_body = `<strong>${displaynameEscaped}</strong> sent ${msg} <em>${escapeHtml(filename)}</em>: `
				+ `<a href="${escapeUrl}">${escapeUrl}</a>`;
		}
	}

	private getMessageType(event: MessageEvent<MessageEventContent>): string {
		let msgtype = "";
		try {
			msgtype = event.messageType;
		} catch (e) { }
		if (event.type !== "m.room.message") {
			msgtype = event.type;
		}
		return msgtype;
	}

	private async getSendingUser(
		puppetData: IPuppet | boolean,
		roomId: string,
		userId: string,
		sender?: string,
	): Promise<ISendingUser | null> {
		if (!puppetData || (typeof puppetData !== "boolean" && puppetData.type !== "relay")) {
			return null;
		}
		const membership = await this.getRoomMemberInfo(roomId, userId);
		let user: IRemoteUser | null = null;
		try {
			user = await this.getUserParts(userId, sender || userId);
		} catch {} // ignore error
		if (!membership) {
			return {
				displayname: userId.substr(1).split(":")[0],
				mxid: userId,
				avatarMxc: null,
				avatarUrl: null,
				user,
			};
		}
		let avatarMxc: string | null = null;
		let avatarUrl: string | null = null;
		if (typeof membership.avatar_url === "string") {
			avatarMxc = membership.avatar_url;
			avatarUrl = this.bridge.getUrlFromMxc(avatarMxc, AVATAR_SIZE, AVATAR_SIZE, "scale");
		}
		return {
			displayname: membership.displayname!,
			mxid: userId,
			avatarMxc,
			avatarUrl,
			user,
		};
	}

	private async getUserParts(mxid: string, sender: string): Promise<IRemoteUser | null> {
		return await this.bridge.namespaceHandler.getRemoteUser(this.bridge.userSync.getPartsFromMxid(mxid), sender);
	}

	private async getRoomParts(mxid: string, sender: string): Promise<IRemoteRoom | null> {
		return await this.bridge.namespaceHandler.getRemoteRoom(await this.bridge.roomSync.getPartsFromMxid(mxid), sender);
	}
}
