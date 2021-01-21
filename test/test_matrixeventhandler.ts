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

import { expect } from "chai";
import { MatrixEventHandler } from "../src/matrixeventhandler";
import {
	RoomEvent, RoomEventContent, MembershipEvent, RedactionEvent, MessageEventContent, MessageEvent,
	FileMessageEventContent, TextualMessageEventContent,
} from "@sorunome/matrix-bot-sdk";
import * as prometheus from "prom-client";
import { MessageDeduplicator } from "../src/structures/messagededuplicator";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

interface IHandlerOpts {
	puppetHasAvatar?: boolean;
	puppetHasName?: boolean;
	relayEnabled?: boolean;
	featureImage?: boolean;
	featureAudio?: boolean;
	featureVideo?: boolean;
	featureSticker?: boolean;
	featureFile?: boolean;
	featureEdit?: boolean;
	featureReply?: boolean;
	createDmHook?: boolean;
	getDmRoomIdHook?: any;
	createRoomHook?: any;
}

const DEDUPLICATOR_TIMEOUT = 100;

let PUPPETSTORE_JOINED_GHOST_TO_ROOM = "";
let PUPPETSTORE_LEAVE_GHOST_FROM_ROOM = "";
let PUPPETSTORE_SET_MXID_INFO = false;
let USERSYNC_SET_ROOM_OVERRIDE = false;
let ROOMSYNC_MAYBE_LEAVE_GHOST = "";
let ROOMSYNC_MARK_AS_DIRECT = "";
let BRIDGE_EVENTS_EMITTED: any[] = [];
let BRIDGE_ROOM_MXID_UNBRIDGED = "";
let BRIDGE_ROOM_ID_UNBRIDGED = "";
let BRIDGE_ROOM_ID_BRIDGED = "";
let PROVISIONER_GET_MXID_CALLED = false;
let ROOM_SYNC_GET_PARTS_FROM_MXID_CALLED = false;
let BOT_PROVISIONER_EVENT_PROCESSED = false;
let BOT_PROVISIONER_ROOM_EVENT_PROCESSED = false;
let DELAYED_FUNCTION_SET = async () => {};
let BOT_INTENT_JOIN_ROOM = "";
let GHOST_INTENT_LEAVE_ROOM = "";
let GHOST_INTENT_JOIN_ROOM = "";
let ROOM_SYNC_INSERTED_ENTRY = false;
let REACTION_HANDLER_ADDED_MATRIX = false;
let REACTION_HANDLER_HANDLED_REDACT = false;
let PRESENCE_HANDLER_SET_STATUS_IN_ROOM = "";
function getHandler(opts?: IHandlerOpts) {
	if (!opts) {
		opts = {};
	}
	PUPPETSTORE_JOINED_GHOST_TO_ROOM = "";
	PUPPETSTORE_SET_MXID_INFO = false;
	USERSYNC_SET_ROOM_OVERRIDE = false;
	ROOMSYNC_MAYBE_LEAVE_GHOST = "";
	ROOMSYNC_MARK_AS_DIRECT = "";
	BRIDGE_EVENTS_EMITTED = [];
	BRIDGE_ROOM_MXID_UNBRIDGED = "";
	BRIDGE_ROOM_ID_UNBRIDGED = "";
	BRIDGE_ROOM_ID_BRIDGED = "";
	PROVISIONER_GET_MXID_CALLED = false;
	ROOM_SYNC_GET_PARTS_FROM_MXID_CALLED = false;
	BOT_PROVISIONER_EVENT_PROCESSED = false;
	BOT_PROVISIONER_ROOM_EVENT_PROCESSED = false;
	DELAYED_FUNCTION_SET = async () => {};
	BOT_INTENT_JOIN_ROOM = "";
	GHOST_INTENT_LEAVE_ROOM = "";
	GHOST_INTENT_JOIN_ROOM = "";
	ROOM_SYNC_INSERTED_ENTRY = false;
	REACTION_HANDLER_ADDED_MATRIX = false;
	REACTION_HANDLER_HANDLED_REDACT = false;
	PRESENCE_HANDLER_SET_STATUS_IN_ROOM = "";
	const bridge = {
		hooks: opts!.createDmHook ? {
			getDmRoomId: opts!.getDmRoomIdHook || true,
			createRoom: opts!.createRoomHook || true,
		} : {},
		protocol: {
			id: "remote",
			features: {
				image: opts!.featureImage || false,
				audio: opts!.featureAudio || false,
				video: opts!.featureVideo || false,
				sticker: opts!.featureSticker || false,
				file: opts!.featureFile || false,
				edit: opts!.featureEdit || false,
				reply: opts!.featureReply || false,
			},
		},
		emit: (type) => {
			BRIDGE_EVENTS_EMITTED.push(type);
		},
		getUrlFromMxc: (mxc) => "https://" + mxc,
		unbridgeRoomByMxid: async (roomId) => {
			BRIDGE_ROOM_MXID_UNBRIDGED = roomId;
		},
		unbridgeRoom: async (room) => {
			BRIDGE_ROOM_ID_UNBRIDGED = room.roomId;
		},
		bridgeRoom: async (room) => {
			BRIDGE_ROOM_ID_BRIDGED = room.roomId;
		},
		namespaceHandler: {
			getRemoteUser: async (user, sender) => {
				return user;
			},
			getRemoteRoom: async (room, sender) => {
				return room;
			},
		},
		getMxidForUser: async (user, override) => `@_puppet_${user.puppetId}_${user.userId}:example.org`,
		AS: {
			isNamespacedUser: (userId) => userId.startsWith("@_puppet"),
			botIntent: {
				userId: "@_puppetbot:example.org",
				joinRoom: async (roomId) => {
					BOT_INTENT_JOIN_ROOM = roomId;
				},
			},
			getIntentForUserId: (userId) => {
				return {
					leaveRoom: async (roomId) => {
						GHOST_INTENT_LEAVE_ROOM = roomId;
					},
					joinRoom: async (roomId) => {
						GHOST_INTENT_JOIN_ROOM = roomId;
					},
				};
			},
		},
		delayedFunction: {
			set: (key, fn, timeout, opt) => {
				DELAYED_FUNCTION_SET = fn;
			},
		},
		botProvisioner: {
			processEvent: async (roomId, event) => {
				BOT_PROVISIONER_EVENT_PROCESSED = true;
			},
			processRoomEvent: async (roomId, event) => {
				BOT_PROVISIONER_ROOM_EVENT_PROCESSED = true;
			},
		},
		puppetStore: {
			joinGhostToRoom: async (ghostId, roomId) => {
				PUPPETSTORE_JOINED_GHOST_TO_ROOM = `${ghostId};${roomId}`;
			},
			leaveGhostFromRoom: async (ghostId, roomId) => {
				PUPPETSTORE_LEAVE_GHOST_FROM_ROOM = `${ghostId};${roomId}`;
			},
			getOrCreateMxidInfo: async (puppetMxid) => {
				const ret = {
					avatarMxc: "",
					name: "",
				} as any;
				if (opts!.puppetHasAvatar) {
					ret.avatarMxc = "mxc://avatar/example.com";
				}
				if (opts!.puppetHasName) {
					ret.name = "User";
				}
				return ret;
			},
			setMxidInfo: async (puppet) => {
				PUPPETSTORE_SET_MXID_INFO = true;
			},
		},
		userSync: {
			getPartsFromMxid: (ghostId) => {
				if (ghostId.startsWith("@_puppet_1_fox:")) {
					return {
						userId: "fox",
						puppetId: 1,
					};
				}
				if (ghostId.startsWith("@_puppet_1_newfox:")) {
					return {
						userId: "newfox",
						puppetId: 1,
					};
				}
				if (ghostId.startsWith("@_puppet_999_otherfox:")) {
					return {
						userId: "otherfox",
						puppetId: 999,
					};
				}
				return null;
			},
			setRoomOverride: async (userParts, roomId) => {
				USERSYNC_SET_ROOM_OVERRIDE = true;
			},
			getClient: async (parts) => {},
		},
		roomSync: {
			getPartsFromMxid: async (roomId) => {
				ROOM_SYNC_GET_PARTS_FROM_MXID_CALLED = true;
				if (roomId.startsWith("!foxdm:")) {
					return {
						roomId: "foxdm",
						puppetId: 1,
					};
				}
				if (roomId.startsWith("#_puppet_1_foxroom:")) {
					return {
						roomId: "foxroom",
						puppetId: 1,
					};
				}
				if (roomId.startsWith("!room:")) {
					return {
						roomId: "room",
						puppetId: 1,
					};
				}
				return null;
			},
			maybeLeaveGhost: async (roomId, userId) => {
				ROOMSYNC_MAYBE_LEAVE_GHOST = `${userId};${roomId}`;
			},
			maybeGet: async (room) => {
				if (room.roomId === "fox" && room.puppetId === 1) {
					return room;
				}
				if (room.roomId === "foxdm" && room.puppetId === 1) {
					return {
						roomdId: "foxdm",
						puppetId: 1,
						isDirect: true,
					};
				}
				return null;
			},
			insert: async (roomId, roomData) => {
				ROOM_SYNC_INSERTED_ENTRY = true;
			},
			getRoomOp: async (opRoomId) => {
				return {
					getRoomStateEvent: async (_, state, key) => {
						if (state === "m.room.member" && key === "user") {
							return {
								membership: "join",
								displayname: "User",
								avatar_url: "blah",
							};
						}
					},
					getEvent: async (roomId, eventId) => {
						if (eventId === "$event:example.org") {
							return {
								type: "m.room.message",
								content: {
									msgtype: "m.text",
									body: "original message",
								},
								sender: "user",
							};
						}
					},
				};
			},
			markAsDirect: (room) => {
				ROOMSYNC_MARK_AS_DIRECT = `${room.puppetId};${room.roomId}`;
			},
			markAsUsed: (room) => { },
		},
		provisioner: {
			get: async (puppetId) => {
				if (puppetId === 1) {
					return {
						puppetMxid: "@user:example.org",
						userId: "puppetGhost",
						type: opts!.relayEnabled ? "relay" : "puppet",
						autoinvite: true,
						isPrivate: true,
					};
				}
				return null;
			},
			getMxid: async (puppetId) => {
				PROVISIONER_GET_MXID_CALLED = true;
				if (puppetId === 1) {
					return "@user:example.org";
				}
				return "";
			},
			getForMxid: async (puppetMxid) => {
				if (puppetMxid === "@user:example.org") {
					return [
						{
							puppetId: 1,
							type: "puppet",
							puppetMxid,
						},
						{
							puppetId: 2,
							type: "puppet",
							puppetMxid,
						},
					];
				}
				return [];
			},
			canRelay: (mxid) => !mxid.startsWith("@bad"),
			adjustMute: async (userId, room) => {},
		},
		eventSync: {
			getRemote: (room, mxid) => {
				if (mxid.split(";")[0] === "$bad:example.org") {
					return ["bad"];
				}
				if (mxid.split(";")[0] === "$event:example.org") {
					return ["event"];
				}
				return [];
			},
		},
		reactionHandler: {
			addMatrix: async (room, relEvent, eventId, key) => {
				REACTION_HANDLER_ADDED_MATRIX = true;
			},
			handleRedactEvent: async (roomEvent) => {
				REACTION_HANDLER_HANDLED_REDACT = true;
			},
		},
		presenceHandler: {
			setStatusInRoom: async (userId, roomId) => {
				PRESENCE_HANDLER_SET_STATUS_IN_ROOM = `${userId};${roomId}`;
			},
		},
		typingHandler: {
			deduplicator: new MessageDeduplicator(DEDUPLICATOR_TIMEOUT, DEDUPLICATOR_TIMEOUT + DEDUPLICATOR_TIMEOUT),
		},
		metrics: {},
	} as any;
	prometheus.register.clear();
	return new MatrixEventHandler(bridge);
}

describe("MatrixEventHandler", () => {
	describe("handleRoomEvent", () => {
		it("should route joins to the join handler", async () => {
			const handler = getHandler();
			let joinHandled = false;
			handler["handleJoinEvent"] = async (roomId, evt) => {
				joinHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.room.member",
				content: {
					membership: "join",
				},
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(joinHandled).to.be.true;
		});
		it("should route bans to the leave handler", async () => {
			const handler = getHandler();
			let leaveHandled = false;
			handler["handleLeaveEvent"] = async (roomId, evt) => {
				leaveHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.room.member",
				content: {
					membership: "ban",
				},
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(leaveHandled).to.be.true;
		});
		it("should route leaves to the leave handler", async () => {
			const handler = getHandler();
			let leaveHandled = false;
			handler["handleLeaveEvent"] = async (roomId, evt) => {
				leaveHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.room.member",
				content: {
					membership: "leave",
				},
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(leaveHandled).to.be.true;
		});
		it("should route redactions to the redaction handler", async () => {
			const handler = getHandler();
			let redactionHandled = false;
			handler["handleRedactEvent"] = async (roomId, evt) => {
				redactionHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.room.redaction",
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(redactionHandled).to.be.true;
		});
		it("should route stickers to the message handler", async () => {
			const handler = getHandler();
			let messageHandled = false;
			handler["handleMessageEvent"] = async (roomId, evt) => {
				messageHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.sticker",
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(messageHandled).to.be.true;
		});
		it("should route messages to the message handler", async () => {
			const handler = getHandler();
			let messageHandled = false;
			handler["handleMessageEvent"] = async (roomId, evt) => {
				messageHandled = true;
			};
			const event = new RoomEvent<RoomEventContent>({
				type: "m.room.message",
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(messageHandled).to.be.true;
		});
	});
	describe("handleJoinEvent", () => {
		it("should route ghosts to the ghost join handler", async () => {
			const handler = getHandler();
			let ghostJoinHandled = false;
			handler["handleGhostJoinEvent"] = async (roomId, evt) => {
				ghostJoinHandled = true;
			};
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: "@_puppet_1_blah:example.org",
				content: {
					membership: "join",
				},
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(ghostJoinHandled).to.be.true;
		});
		it("should route users to the user join handler", async () => {
			const handler = getHandler();
			let userJoinHandled = false;
			handler["handleUserJoinEvent"] = async (roomId, evt) => {
				userJoinHandled = true;
			};
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: "@user:example.org",
				content: {
					membership: "join",
				},
			});
			await handler["handleRoomEvent"]("!blah:example.org", event);
			expect(userJoinHandled).to.be.true;
		});
	});
	describe("handleGhostJoinEvent", () => {
		it("should add the ghost to the room cache and update status", async () => {
			const handler = getHandler();
			const ghostId = "@_puppet_1_blah:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: ghostId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!blah:example.org";
			await handler["handleGhostJoinEvent"](roomId, event);
			expect(PUPPETSTORE_JOINED_GHOST_TO_ROOM).to.equal(`${ghostId};${roomId}`);
			expect(PRESENCE_HANDLER_SET_STATUS_IN_ROOM).to.equal(`${ghostId};${roomId}`);
		});
		it("should set a room override, are all conditions met", async () => {
			const handler = getHandler();
			const ghostId = "@_puppet_1_fox:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: ghostId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleGhostJoinEvent"](roomId, event);
			expect(USERSYNC_SET_ROOM_OVERRIDE).to.be.true;
		});
		it("should not attempt leave the appservice bot, if not a dm", async () => {
			const handler = getHandler();
			const ghostId = "@_puppet_1_blah:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: ghostId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!blah:example.org";
			await handler["handleGhostJoinEvent"](roomId, event);
			expect(ROOMSYNC_MAYBE_LEAVE_GHOST).to.equal("");
		});
		it("should attempt to leave the appservice bot, if a dm", async () => {
			const handler = getHandler();
			const ghostId = "@_puppet_1_blah:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: ghostId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleGhostJoinEvent"](roomId, event);
			expect(ROOMSYNC_MAYBE_LEAVE_GHOST).to.equal(`@_puppetbot:example.org;${roomId}`);
		});
	});
	describe("handleUserJoinEvent", () => {
		it("should do nothing, if no room is found", async () => {
			const handler = getHandler();
			let updatedCache = false;
			handler["updateCachedRoomMemberInfo"] = async (rid, uid, content) => {
				updatedCache = true;
			};
			const userId = "@user:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: userId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!nonexistant:example.org";
			await handler["handleUserJoinEvent"](roomId, event);
			expect(updatedCache).to.be.false;
		});
		it("should update the member info cache, should the room be found", async () => {
			const handler = getHandler();
			let updatedCache = false;
			handler["updateCachedRoomMemberInfo"] = async (rid, uid, content) => {
				updatedCache = true;
			};
			const userId = "@user:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: userId,
				content: {
					membership: "join",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleUserJoinEvent"](roomId, event);
			expect(updatedCache).to.be.true;
		});
		it("should update the puppets name, if a new one is present", async () => {
			const handler = getHandler();
			const userId = "@user:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: userId,
				content: {
					displayname: "Fox Lover",
					membership: "join",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleUserJoinEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(2);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["puppetName", "puppetName"]);
			expect(PUPPETSTORE_SET_MXID_INFO).to.be.true;
		});
		it("should update the puppets avatar, if a new one is present", async () => {
			const handler = getHandler();
			const userId = "@user:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: userId,
				content: {
					avatar_url: "mxc://fox/example.org",
					membership: "join",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleUserJoinEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(2);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["puppetAvatar", "puppetAvatar"]);
			expect(PUPPETSTORE_SET_MXID_INFO).to.be.true;
		});
	});
	describe("handleLeaveEvent", () => {
		it("should leave the ghost of the room, if it was a ghost", async () => {
			const handler = getHandler();
			const userId = "@user:example.org";
			const ghostId = "@_puppet_1_fox:example.org";
			const event = new MembershipEvent({
				type: "m.room.member",
				state_key: ghostId,
				sender: ghostId,
				content: {
					membership: "leave",
				},
			});
			const roomId = "!blah:example.org";
			await handler["handleLeaveEvent"](roomId, event);
			expect(PUPPETSTORE_LEAVE_GHOST_FROM_ROOM).to.equal(`${ghostId};${roomId}`);
			expect(BRIDGE_ROOM_MXID_UNBRIDGED).to.equal("");
		});
	});
	describe("handleRedactEvent", () => {
		it("should ignore redactions from ghosts", async () => {
			const handler = getHandler();
			const event = new RedactionEvent({
				type: "m.room.redaction",
				sender: "@_puppet_1_fox:example.org",
				redacts: "$bad:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleRedactEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(0);
		});
		it("should ignore redactions from unknown rooms", async () => {
			const handler = getHandler();
			const event = new RedactionEvent({
				type: "m.room.redaction",
				sender: "@user:example.org",
				redacts: "$bad:example.org",
			});
			const roomId = "!invalid:example.org";
			await handler["handleRedactEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(0);
		});
		it("should ignore redacts, if not from the puppet user", async () => {
			const handler = getHandler();
			const event = new RedactionEvent({
				type: "m.room.redaction",
				sender: "@wronguser:example.org",
				redacts: "$bad:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleRedactEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(0);
		});
		it("should not redact if the dedupe flag is set", async () => {
			const handler = getHandler();
			const event = new RedactionEvent({
				type: "m.room.redaction",
				sender: "@user:example.org",
				redacts: "$bad:example.org",
				content: { source: "remote" },
			});
			const roomId = "!foxdm:example.org";
			await handler["handleRedactEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(0);
		});
		it("should redact events, should all check out", async () => {
			const handler = getHandler();
			const event = new RedactionEvent({
				type: "m.room.redaction",
				sender: "@user:example.org",
				redacts: "$bad:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleRedactEvent"](roomId, event);
			expect(BRIDGE_EVENTS_EMITTED.length).to.equal(1);
			expect(BRIDGE_EVENTS_EMITTED[0]).to.equal("redact");
			expect(REACTION_HANDLER_HANDLED_REDACT).to.be.true;
		});
	});
	describe("handleMessageEvent", () => {
		it("should drop messages from ghosts", async () => {
			const handler = getHandler();
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@_puppet_1_fox:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(ROOM_SYNC_GET_PARTS_FROM_MXID_CALLED).to.be.false;
		});
		it("should forward messages to the bot provisioner, if no associated room is found", async () => {
			const handler = getHandler();
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@user:example.org",
			});
			const roomId = "!invalid:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(ROOM_SYNC_GET_PARTS_FROM_MXID_CALLED).to.be.true;
			expect(BOT_PROVISIONER_EVENT_PROCESSED).to.be.true;
		});
		it("should drop the message, if it wasn't sent by us", async () => {
			const handler = getHandler();
			let messageHandled = false;
			handler["handleFileEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			handler["handleTextEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@wronguser:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(messageHandled).to.be.false;
		});
		it("should drop the message if relay is enabled but sender is blacklisted", async () => {
			const handler = getHandler({
				relayEnabled: true,
			});
			let messageHandled = false;
			handler["handleFileEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			handler["handleTextEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@baduser:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(messageHandled).to.be.false;
		});
		it("should apply relay formatting, if relay is enabled", async () => {
			const handler = getHandler({
				relayEnabled: true,
			});
			let relayFormattingApplied = false;
			handler["applyRelayFormatting"] = async (rid, room, evt) => {
				relayFormattingApplied = true;
			};
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@gooduser:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(relayFormattingApplied).to.true;
		});
		it("should delay-leave the ghost of the puppet", async () => {
			const handler = getHandler();
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@user:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			await DELAYED_FUNCTION_SET();
			expect(ROOMSYNC_MAYBE_LEAVE_GHOST).to.equal("@_puppet_1_puppetGhost:example.org;!foxdm:example.org");
		});
		it("should de-duplicate messages, if the remote flag is set", async () => {
			const handler = getHandler();
			let messageHandled = false;
			handler["handleFileEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			handler["handleTextEvent"] = async (rid, room, puppet, evt) => {
				messageHandled = true;
			};
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@user:example.org",
				content: { source: "remote" },
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(messageHandled).to.be.false;
		});
		it("should pass the message on to file handler, if it is a file msgtype", async () => {
			for (const msgtype of ["m.file", "m.image", "m.audio", "m.sticker", "m.video"]) {
				const handler = getHandler();
				let fileMessageHandled = false;
				handler["handleFileEvent"] = async (rid, room, puppet, evt) => {
					fileMessageHandled = true;
				};
				const event = new MessageEvent<MessageEventContent>({
					type: "m.room.message",
					sender: "@user:example.org",
					content: {
						msgtype,
						body: "",
					},
				});
				const roomId = "!foxdm:example.org";
				await handler["handleMessageEvent"](roomId, event);
				expect(fileMessageHandled).to.be.true;
			}
		});
		it("should pass the message on to the text handler, if it is a text msgtype", async () => {
			for (const msgtype of ["m.text", "m.notice", "m.emote", "m.reaction"]) {
				const handler = getHandler();
				let textMessageHandled = false;
				handler["handleTextEvent"] = async (rid, room, puppet, evt) => {
					textMessageHandled = true;
				};
				const event = new MessageEvent<MessageEventContent>({
					type: "m.room.message",
					sender: "@user:example.org",
					content: {
						msgtype,
						body: "",
					},
				});
				const roomId = "!foxdm:example.org";
				await handler["handleMessageEvent"](roomId, event);
				expect(textMessageHandled).to.be.true;
			}
		});
		it("should pass the message on to the bot provisioner, if it starts with the correct prefix", async () => {
			const handler = getHandler();
			let textMessageHandled = false;
			handler["handleTextEvent"] = async (rid, room, puppet, evt) => {
				textMessageHandled = true;
			};
			const event = new MessageEvent<MessageEventContent>({
				type: "m.room.message",
				sender: "@user:example.org",
				content: {
					msgtype: "m.text",
					body: "!remote fox",
				},
			});
			const roomId = "!foxdm:example.org";
			await handler["handleMessageEvent"](roomId, event);
			expect(textMessageHandled).to.be.false;
			expect(BOT_PROVISIONER_ROOM_EVENT_PROCESSED).to.be.true;
		});
	});
	describe("handleFileEvent", () => {
		it("should fall back to text messages, if no features are enabled", async () => {
			for (const msgtype of ["m.image", "m.audio", "m.video", "m.sticker", "m.file"]) {
				const handler = getHandler();
				const event = new MessageEvent<FileMessageEventContent>({
					type: "m.room.message",
					content: {
						msgtype,
						url: "https://example.org/fox.file",
					},
				});
				const roomId = "!foxdm:example.org";
				const room = {} as any;
				const puppet = {} as any;
				await handler["handleFileEvent"](roomId, room, puppet, event);
				expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
			}
		});
		it("should send files as their type, if the features are enabled", async () => {
			for (const msgtype of ["m.image", "m.audio", "m.video", "m.sticker", "m.file"]) {
				const handler = getHandler({
					featureImage: true,
					featureAudio: true,
					featureVideo: true,
					featureSticker: true,
					featureFile: true,
				});
				const event = new MessageEvent<FileMessageEventContent>({
					type: "m.room.message",
					content: {
						msgtype,
						url: "https://example.org/fox.file",
					},
				});
				const roomId = "!foxdm:example.org";
				const room = {} as any;
				const puppet = {} as any;
				await handler["handleFileEvent"](roomId, room, puppet, event);
				expect(BRIDGE_EVENTS_EMITTED).to.eql([msgtype.substring(2)]);
			}
		});
		it("should fall everything back to file, if that is enabled", async () => {
			for (const msgtype of ["m.image", "m.audio", "m.video", "m.sticker", "m.file"]) {
				const handler = getHandler({
					featureFile: true,
				});
				const event = new MessageEvent<FileMessageEventContent>({
					type: "m.room.message",
					content: {
						msgtype,
						url: "https://example.org/fox.file",
					},
				});
				const roomId = "!foxdm:example.org";
				const room = {} as any;
				const puppet = {} as any;
				await handler["handleFileEvent"](roomId, room, puppet, event);
				expect(BRIDGE_EVENTS_EMITTED).to.eql(["file"]);
			}
		});
		it("should fall stickers back to images, if they are enabled", async () => {
			const handler = getHandler({
				featureImage: true,
			});
			const event = new MessageEvent<FileMessageEventContent>({
				type: "m.room.message",
				content: {
					msgtype: "m.sticker",
					url: "https://example.org/fox.file",
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleFileEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["image"]);
		});
	});
	describe("handleTextEvent", () => {
		it("should detect and send edits, if the feature is enabled", async () => {
			const handler = getHandler({
				featureEdit: true,
			});
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "* blah",
					"m.relates_to": {
						event_id: "$event:example.org",
						rel_type: "m.replace",
					},
					"m.new_content": {
						msgtype: "m.text",
						body: "blah",
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["edit"]);
		});
		it("should fall edits back to messages, if the remote id isn't found", async () => {
			const handler = getHandler({
				featureEdit: true,
			});
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "* blah",
					"m.relates_to": {
						event_id: "$notfound:example.org",
						rel_type: "m.replace",
					},
					"m.new_content": {
						msgtype: "m.text",
						body: "blah",
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
		});
		it("should fall edits back to messages, if the feature is disabled", async () => {
			const handler = getHandler();
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "* blah",
					"m.relates_to": {
						event_id: "$event:example.org",
						rel_type: "m.replace",
					},
					"m.new_content": {
						msgtype: "m.text",
						body: "blah",
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
		});
		it("should detect and send replies, if they are enabled", async () => {
			const handler = getHandler({
				featureReply: true,
			});
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "blah",
					"m.relates_to": {
						"m.in_reply_to": {
							event_id: "$event:example.org",
						},
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["reply"]);
		});
		it("should fall replies back to messages, if the remote isn't found", async () => {
			const handler = getHandler({
				featureReply: true,
			});
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "blah",
					"m.relates_to": {
						"m.in_reply_to": {
							event_id: "$notfound:example.org",
						},
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
		});
		it("should fall replies back to messages, if the feature is disabled", async () => {
			const handler = getHandler();
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"msgtype": "m.text",
					"body": "blah",
					"m.relates_to": {
						"m.in_reply_to": {
							event_id: "$event:example.org",
						},
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
		});
		it("should detect reactions", async () => {
			const handler = getHandler();
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					"m.relates_to": {
						event_id: "$event:example.org",
						rel_type: "m.annotation",
						key: "fox",
					},
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(REACTION_HANDLER_ADDED_MATRIX).to.be.true;
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["reaction"]);
		});
		it("should send normal messages", async () => {
			const handler = getHandler();
			const event = new MessageEvent<TextualMessageEventContent>({
				content: {
					msgtype: "m.text",
					body: "FOXIES!!!",
				},
			});
			const roomId = "!foxdm:example.org";
			const room = {} as any;
			const puppet = {} as any;
			await handler["handleTextEvent"](roomId, room, puppet, event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["message"]);
		});
	});
	describe("handleInviteEvent", () => {
		it("should short-circuit bot user invites", async () => {
			const handler = getHandler();
			const event = new MembershipEvent({
				state_key: "@_puppetbot:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(BOT_INTENT_JOIN_ROOM).to.equal(roomId);
		});
		it("should ignore invites if no ghost got invited", async () => {
			const handler = getHandler();
			const event = new MembershipEvent({
				state_key: "@blubb:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal("");
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should ignore invites, if a ghost invited", async () => {
			const handler = getHandler();
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@_puppet_1_newfox:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal("");
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should ignore invites, if the corresponding room already exists", async () => {
			const handler = getHandler();
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!foxdm:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal("");
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if the protocol didn't set up the necessary hooks", async () => {
			const handler = getHandler();
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if the invited mxid is un-parsable", async () => {
			const handler = getHandler({
				createDmHook: true,
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_invalid:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if we try to invite someone elses puppet", async () => {
			const handler = getHandler({
				createDmHook: true,
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_999_otherfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if no DM room ID is found", async () => {
			const handler = getHandler({
				createDmHook: true,
				getDmRoomIdHook: async (parts) => null,
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if the room already exists", async () => {
			const handler = getHandler({
				createDmHook: true,
				getDmRoomIdHook: async (parts) => "fox",
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_1_fox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should reject invites, if the create room data doesn't match up", async () => {
			const handler = getHandler({
				createDmHook: true,
				getDmRoomIdHook: async (parts) => "newfox",
				createRoomHook: async (parts) => {
					return {
						puppetId: 42,
						roomId: "bruhuu",
					};
				},
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal(roomId);
			expect(GHOST_INTENT_JOIN_ROOM).to.equal("");
		});
		it("should create and insert the new DM into the db, if all is ok", async () => {
			const handler = getHandler({
				createDmHook: true,
				getDmRoomIdHook: async (parts) => "newfox",
				createRoomHook: async (parts) => {
					return {
						puppetId: 1,
						roomId: "newfox",
						isDirect: true,
					};
				},
			});
			const event = new MembershipEvent({
				state_key: "@_puppet_1_newfox:example.org",
				sender: "@user:example.org",
			});
			const roomId = "!blah:example.org";
			await handler["handleInviteEvent"](roomId, event);
			expect(GHOST_INTENT_LEAVE_ROOM).to.equal("");
			expect(GHOST_INTENT_JOIN_ROOM).to.equal(roomId);
			expect(ROOM_SYNC_INSERTED_ENTRY).to.be.true;
			expect(ROOMSYNC_MARK_AS_DIRECT).to.equal("1;newfox");
		});
	});
	describe("handleRoomQuery", () => {
		it("should immidiately reject the creation of a new room", async () => {
			const handler = getHandler();
			const alias = "#_puppet_1_foxroom:example.org";
			let rejected = false;
			await handler["handleRoomQuery"](alias, async (type) => {
				rejected = !type;
			});
			expect(rejected).to.be.true;
		});
		it("should ignore if the room is invalid", async () => {
			const handler = getHandler();
			const alias = "#_puppet_invalid:example.org";
			await handler["handleRoomQuery"](alias, async (type) => {});
			expect(BRIDGE_ROOM_ID_BRIDGED).to.equal("");
		});
		it("should bridge a room, if it is valid", async () => {
			const handler = getHandler();
			const alias = "#_puppet_1_foxroom:example.org";
			await handler["handleRoomQuery"](alias, async (type) => {});
			expect(BRIDGE_ROOM_ID_BRIDGED).to.equal("foxroom");
		});
	});
	describe("handlePresence", () => {
		it("should do nothing on own presence", async () => {
			const handler = getHandler();
			const event = {
				type: "m.presence",
				sender: "@_puppet_1_fox:example.org",
				content: {
					presence: "online",
				},
			};
			await handler["handlePresence"](event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql([]);
		});
		it("should emit user presence", async () => {
			const handler = getHandler();
			const event = {
				type: "m.presence",
				sender: "@user:example.org",
				content: {
					presence: "online",
				},
			};
			await handler["handlePresence"](event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["presence"]);
		});
	});
	describe("handleTyping", () => {
		it("should do typing", async () => {
			const handle = getHandler();
			let event: any = {
				type: "m.typing",
				content: {
					user_ids: ["@user:example.org"],
				},
				room_id: "!room:example.org",
			};
			await handle["handleTyping"]("!room:example.org", event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["typing"]);
			expect(await handle["bridge"].typingHandler.deduplicator.dedupe("1;room", "puppetGhost", undefined, "true"))
				.to.be.true;
			await handle["handleTyping"]("!room:example.org", event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["typing"]);
			event = {
				type: "m.typing",
				content: {
					user_ids: [],
				},
				room_id: "!room:example.org",
			};
			await handle["handleTyping"]("!room:example.org", event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["typing", "typing"]);
			expect(await handle["bridge"].typingHandler.deduplicator.dedupe("1;room", "puppetGhost", undefined, "false"))
				.to.be.true;
		});
	});
	describe("handleReceipt", () => {
		it("should do read receipts", async () => {
			const handle = getHandler();
			const event = {
				type: "m.receipt",
				room_id: "!room:example.org",
				content: {
					"$event:example.org": {
						"m.read": {
							"@user:example.org": {
								ts: 1234,
							},
						},
					},
				},
			};
			await handle["handleReceipt"]("!room:example.org", event);
			expect(BRIDGE_EVENTS_EMITTED).to.eql(["read"]);
		});
	});
	describe("getRoomDisplaynameCache", () => {
		it("should return a blank object on new rooms", () => {
			const handler = getHandler();
			const ret = handler["getRoomDisplaynameCache"]("room");
			expect(ret).eql({});
		});
		it("should return an existing entry, should it exist", () => {
			const handler = getHandler();
			handler["updateCachedRoomMemberInfo"]("room", "user", {
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			});
			const ret = handler["getRoomDisplaynameCache"]("room");
			expect(ret).eql({user: {
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			}});
		});
	});
	describe("updateCachedRoomMemberInfo", () => {
		it("should update an entry", () => {
			const handler = getHandler();
			handler["updateCachedRoomMemberInfo"]("room", "user", {
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			});
			const ret = handler["getRoomDisplaynameCache"]("room");
			expect(ret).eql({user: {
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			}});
		});
	});
	describe("getRoomMemberInfo", () => {
		it("should fetch members from the cache, if present", async () => {
			const handler = getHandler();
			handler["updateCachedRoomMemberInfo"]("room", "user", {
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			});
			const ret = await handler["getRoomMemberInfo"]("room", "user");
			expect(ret).eql({
				displayname: "blah",
				avatar_url: "blubb",
				membership: "join",
			});
		});
		it("should try to fetch from the state, if not present in cache", async () => {
			const handler = getHandler();
			const ret = await handler["getRoomMemberInfo"]("room", "user");
			expect(ret).eql({
				membership: "join",
				displayname: "User",
				avatar_url: "blah",
			});
		});
	});
	describe("applyRelayFormatting", () => {
		it("should apply simple formatting", async () => {
			const handler = getHandler();
			const roomId = "room";
			const userId = "user";
			const content = {
				msgtype: "m.text",
				body: "hello world",
			};
			await handler["applyRelayFormatting"](roomId, userId, content);
			expect(content).eql({
				msgtype: "m.text",
				body: "User: hello world",
				formatted_body: "<strong>User</strong>: hello world",
				format: "org.matrix.custom.html",
			});
		});
		it("should apply emote formatting", async () => {
			const handler = getHandler();
			const roomId = "room";
			const userId = "user";
			const content = {
				msgtype: "m.emote",
				body: "hello world",
			};
			await handler["applyRelayFormatting"](roomId, userId, content);
			expect(content).eql({
				msgtype: "m.text",
				body: "*User hello world",
				formatted_body: "*<strong>User</strong> hello world",
				format: "org.matrix.custom.html",
			});
		});
		it("should create a fallback for files", async () => {
			const handler = getHandler();
			const roomId = "room";
			const userId = "user";
			const content = {
				msgtype: "m.file",
				body: "hello world",
				url: "mxc://somefile",
			};
			await handler["applyRelayFormatting"](roomId, userId, content);
			expect(content).eql({
				msgtype: "m.text",
				body: "User sent a file hello world: https://mxc://somefile",
				format: "org.matrix.custom.html",
				formatted_body: "<strong>User</strong> sent a file <em>hello world</em>: <a href=\"https://mxc://somefile\">" +
					"https://mxc://somefile</a>",
			});
		});
		it("should proceed into edits appropriately", async () => {
			const handler = getHandler();
			const roomId = "room";
			const userId = "user";
			const content = {
				"msgtype": "m.text",
				"body": "hello world",
				"m.new_content": {
					msgtype: "m.text",
					body: "hello world",
				},
			};
			await handler["applyRelayFormatting"](roomId, userId, content);
			expect(content).eql({
				"msgtype": "m.text",
				"body": "User: hello world",
				"format": "org.matrix.custom.html",
				"formatted_body": "<strong>User</strong>: hello world",
				"m.new_content": {
					msgtype: "m.text",
					body: "User: hello world",
					formatted_body: "<strong>User</strong>: hello world",
					format: "org.matrix.custom.html",
				},
			});
		});
	});
});
