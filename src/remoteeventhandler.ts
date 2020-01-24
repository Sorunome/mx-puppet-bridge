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
import { Util } from "./util";
import { TimedCache } from "./structures/timedcache";
import { IRemoteUser, IReceiveParams, IMessageEvent } from "./interfaces";
import { MatrixPresence } from "./presencehandler";
import {
	TextualMessageEventContent, FileMessageEventContent, FileWithThumbnailInfo, MatrixClient,
} from "matrix-bot-sdk";

const log = new Log("RemoteEventHandler");

// tslint:disable no-magic-numbers
const GHOST_PUPPET_LEAVE_TIMEOUT = 1000 * 60 * 60;
const PUPPET_INVITE_CACHE_LIFETIME = 1000 * 60 * 60 * 24;
// tslint:enable no-magic-numbers

interface ISendInfo {
	client: MatrixClient;
	mxid: string;
}

export class RemoteEventHandler {
	private ghostInviteCache: TimedCache<string, boolean>;

	constructor(
		private bridge: PuppetBridge,
	) {
		this.ghostInviteCache = new TimedCache(PUPPET_INVITE_CACHE_LIFETIME);
	}

	public async setUserPresence(user: IRemoteUser, presence: MatrixPresence) {
		if (this.bridge.protocol.features.presence && this.bridge.config.presence.enabled) {
			log.verbose(`Setting user presence for userId=${user.userId} to ${presence}`);
			const client = await this.bridge.userSync.maybeGetClient(user);
			if (!client) {
				return;
			}
			const userId = await client.getUserId();
			this.bridge.presenceHandler.set(userId, presence);
		}
	}

	public async setUserStatus(user: IRemoteUser, status: string) {
		if (this.bridge.protocol.features.presence && this.bridge.config.presence.enabled) {
			log.verbose(`Setting user status for userId=${user.userId} to ${status}`);
			const client = await this.bridge.userSync.maybeGetClient(user);
			if (!client) {
				return;
			}
			const userId = await client.getUserId();
			this.bridge.presenceHandler.setStatus(userId, status);
		}
	}

	public async setUserTyping(params: IReceiveParams, typing: boolean) {
		log.verbose(`Setting user typing for userId=${params.user.userId} in roomId=${params.room.roomId} to ${typing}`);
		const ret = await this.maybePrepareSend(params);
		if (!ret) {
			log.verbose("User/Room doesn't exist, ignoring...");
			return;
		}
		await this.bridge.typingHandler.set(await ret.client.getUserId(), ret.mxid, typing);
	}

	public async sendReadReceipt(params: IReceiveParams) {
		log.verbose(`Got request to send read indicators for userId=${params.user.userId} in roomId=${params.room.roomId}`);
		const ret = await this.maybePrepareSend(params);
		if (!ret || !params.eventId) {
			log.verbose("User/Room doesn't exist, ignoring...");
			return;
		}
		const origEvents = await this.bridge.eventStore.getMatrix(params.room.puppetId, params.eventId);
		for (const origEvent of origEvents) {
			await ret.client.sendReadReceipt(ret.mxid, origEvent);
		}
	}

	public async sendMessage(params: IReceiveParams, opts: IMessageEvent) {
		log.info(`Received message from ${params.user.userId} to send to ${params.room.roomId}`);
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const send = {
			msgtype,
			body: opts.body,
		} as TextualMessageEventContent;
		(send as any).source = "remote"; // tslint:disable-line no-any
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			(send as any).external_url = params.externalUrl; // tslint:disable-line no-any
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.bridge.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	public async sendEdit(params: IReceiveParams, eventId: string, opts: IMessageEvent, ix: number = 0) {
		log.info(`Received edit from ${params.user.userId} to send to ${params.room.roomId}`);
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const origEvents = await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId);
		if (ix < 0) {
			// negative indexes are from the back
			ix = origEvents.length + ix;
		}
		if (ix >= origEvents.length) {
			// sanity check on the index
			ix = 0;
		}
		const origEvent = origEvents[ix];
		// this object is set to any-type as the interfaces don't do edits yet
		const send = {
			"msgtype": msgtype,
			"body": `* ${opts.body}`,
			"source": "remote",
			"m.new_content": {
				body: opts.body,
				msgtype,
			},
		} as any; // tslint:disable-line no-any
		if (origEvent) {
			send["m.relates_to"] = {
				event_id: origEvent,
				rel_type: "m.replace",
			};
		} else {
			log.warn("Couldn't find event, sending as normal message...");
		}
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = `* ${opts.formattedBody}`;
			send["m.new_content"].format = "org.matrix.custom.html";
			send["m.new_content"].formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
			send["m.new_content"].external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.bridge.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	public async sendRedact(params: IReceiveParams, eventId: string) {
		log.info(`Received redact from ${params.user.userId} to send to ${params.room.roomId}`);
		const { client, mxid } = await this.prepareSend(params);
		const origEvents = await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId);
		for (const origEvent of origEvents) {
			await this.bridge.redactEvent(client, mxid, origEvent);
		}
	}

	public async sendReply(params: IReceiveParams, eventId: string, opts: IMessageEvent) {
		log.info(`Received reply from ${params.user.userId} to send to ${params.room.roomId}`);
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const origEvents = await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId);
		const origEvent = origEvents[0];
		// this send object needs to be any-type, as the interfaces don't do replies yet
		const send = {
			msgtype,
			body: opts.body,
			source: "remote",
		} as any; // tslint:disable-line no-any
		if (origEvent) {
			send["m.relates_to"] = {
				"m.in_reply_to": {
					event_id: origEvent,
				},
			};
		} else {
			log.warn("Couldn't find event, sending as normal message...");
		}
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.bridge.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	public async sendReaction(params: IReceiveParams, eventId: string, reaction: string) {
		const { client, mxid } = await this.prepareSend(params);
		await this.bridge.reactionHandler.addRemote(params, eventId, reaction, client, mxid);
	}

	public async removeReaction(params: IReceiveParams, eventId: string, reaction: string) {
		const { client, mxid } = await this.prepareSend(params);
		await this.bridge.reactionHandler.removeRemote(params, eventId, reaction, client, mxid);
	}

	public async removeAllReactions(params: IReceiveParams, eventId: string) {
		const { client, mxid } = await this.prepareSend(params);
		await this.bridge.reactionHandler.removeRemoteAllOnMessage(params, eventId, client, mxid);
	}

	public async sendFileByType(msgtype: string, params: IReceiveParams, thing: string | Buffer, name?: string) {
		log.info(`Received file to send from ${params.user.userId} in ${params.room.roomId}.`);
		log.verbose(`thing=${typeof thing === "string" ? thing : "<Buffer>"} name=${name}`);
		if (!name) {
			name = "remote_file";
		}
		const { client, mxid } = await this.prepareSend(params);
		let buffer: Buffer;
		if (typeof thing === "string") {
			buffer = await Util.DownloadFile(thing);
		} else {
			buffer = thing;
		}
		const mimetype = Util.GetMimeType(buffer);
		if (msgtype === "detect") {
			if (mimetype) {
				const type = mimetype.split("/")[0];
				msgtype = {
					audio: "m.audio",
					image: "m.image",
					video: "m.video",
				}[type];
				if (!msgtype) {
					msgtype = "m.file";
				}
			} else {
				msgtype = "m.file";
			}
		}
		const fileMxc = await this.bridge.uploadContent(
			client,
			buffer,
			mimetype,
			name,
		);
		const info = {
			mimetype,
			size: buffer.byteLength,
		} as FileWithThumbnailInfo;
		const sendData = {
			body: name,
			info,
			msgtype,
			url: fileMxc,
		} as FileMessageEventContent;
		(sendData as any).source = "remote"; // tslint:disable-line no-any
		if (typeof thing === "string") {
			(sendData as any).external_url = thing; // tslint:disable-line no-any
		}
		if (params.externalUrl) {
			(sendData as any).external_url = params.externalUrl; // tslint:disable-line no-any
		}
		const matrixEventId = await client.sendMessage(mxid, sendData);
		if (matrixEventId && params.eventId) {
			await this.bridge.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	public async maybePrepareSend(params: IReceiveParams): Promise<ISendInfo | null> {
		log.verbose(`Maybe preparing send parameters`, params);
		const mxid = await this.bridge.roomSync.maybeGetMxid(params.room);
		if (!mxid) {
			return null;
		}
		const client = await this.bridge.userSync.maybeGetClient(params.user);
		if (!client) {
			return null;
		}
		return { client, mxid };
	}

	public async prepareSend(params: IReceiveParams): Promise<ISendInfo> {
		log.verbose(`Preparing send parameters`, params);
		const puppetData = await this.bridge.provisioner.get(params.room.puppetId);
		const puppetMxid = puppetData ? puppetData.puppetMxid : "";
		const client = await this.bridge.userSync.getClient(params.user);
		const userId = await client.getUserId();
		// we could be the one creating the room, no need to invite ourself
		const invites: string[] = [];
		if (userId !== puppetMxid) {
			invites.push(puppetMxid);
		} else {
			// else we need the bot client in order to be able to receive matrix messages
			invites.push(await this.bridge.botIntent.underlyingClient.getUserId());
		}
		const { mxid, created } = await this.bridge.roomSync.getMxid(params.room, client, invites);

		// ensure that the intent is in the room
		if (this.bridge.AS.isNamespacedUser(userId)) {
			log.silly("Joining ghost to room...");
			const intent = this.bridge.AS.getIntentForUserId(userId);
			await intent.ensureRegisteredAndJoined(mxid);
			// if the ghost was ourself, leave it again
			if (puppetData && puppetData.userId === params.user.userId) {
				const delayedKey = `${userId}_${mxid}`;
				this.bridge.delayedFunction.set(delayedKey, async () => {
					await this.bridge.roomSync.maybeLeaveGhost(mxid, userId);
				}, GHOST_PUPPET_LEAVE_TIMEOUT);
			}
			// set the correct m.room.member override if the room just got created
			if (created) {
				log.verbose("Maybe applying room membership overrides");
				await this.bridge.userSync.setRoomOverride(params.user, params.room.roomId, null, client);
			}
		}

		// ensure our puppeted user is in the room
		const cacheKey = `${params.room.puppetId}_${mxid}`;
		try {
			const cache = this.ghostInviteCache.get(cacheKey);
			if (!cache) {
				let inviteClient = await this.bridge.roomSync.getRoomOp(mxid);
				if (!inviteClient) {
					inviteClient = client;
				}
				// we can't really invite ourself...
				if (await inviteClient.getUserId() !== puppetMxid) {
					// we just invited if we created, don't try to invite again
					if (!created) {
						log.silly("Inviting puppet to room...");
						await client.inviteUser(puppetMxid, mxid);
					}
					this.ghostInviteCache.set(cacheKey, true);

					// let's try to also join the room, if we use double-puppeting
					const puppetClient = await this.bridge.userSync.getPuppetClient(params.room.puppetId);
					if (puppetClient) {
						log.silly("Joining the room...");
						await puppetClient.joinRoom(mxid);
					}
				}
			}
		} catch (err) {
			if (err.body.errcode === "M_FORBIDDEN" && err.body.error.includes("is already in the room")) {
				log.verbose("Failed to invite user, as they are already in there");
				this.ghostInviteCache.set(cacheKey, true);
			} else {
				log.warn("Failed to invite user:", err.error || err.body || err);
			}
		}

		return { client, mxid };
	}
}
