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
import * as proxyquire from "proxyquire";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

interface IHandlerOpts {
	enablePresence?: boolean;
	roomCreated?: boolean;
	doublePuppeting?: boolean;
	noautoinvite?: boolean;
	blockMessage?: boolean;
}

let CLIENT_SEND_READ_RECEIPT = "";
let CLIENT_SEND_MESSAGE = {} as any;
let CLIENT_INVITE_USER = "";
let CLIENT_JOIN_ROOM = "";
function getClient(mxid) {
	CLIENT_SEND_READ_RECEIPT = "";
	CLIENT_SEND_MESSAGE = {};
	CLIENT_INVITE_USER = "";
	CLIENT_JOIN_ROOM = "";
	return {
		getUserId: async () => mxid,
		sendReadReceipt: async (roomId, eventId) => {
			CLIENT_SEND_READ_RECEIPT = `${roomId};${eventId}`;
		},
		sendMessage: async (roomId, msg) => {
			CLIENT_SEND_MESSAGE = msg;
			return "$newevent";
		},
		inviteUser: async (userId, roomId) => {
			CLIENT_INVITE_USER = `${userId};${roomId}`;
		},
		joinRoom: async (roomId) => {
			CLIENT_JOIN_ROOM = roomId;
		},
	} as any;
}

let INTENT_REGISTERED_AND_JOINED = "";
let INTENT_LEAVE_ROOM = "";
function getIntent(userId) {
	INTENT_REGISTERED_AND_JOINED = "";
	INTENT_LEAVE_ROOM = "";
	return {
		ensureRegisteredAndJoined: async (mxid) => {
			INTENT_REGISTERED_AND_JOINED = mxid;
		},
		underlyingClient: getClient(userId),
		leaveRoom: async (mxid) => {
			INTENT_LEAVE_ROOM = mxid;
		},
	} as any;
}

let PRESENCE_HANDLER_SET = "";
let PRESENCE_HANDLER_SET_STATUS = "";
let TYPING_HANDLER_SET = "";
let EVENT_STORE_INSERT = "";
let BRIDGE_REDACT_EVENT = "";
let REACTION_HANDLER_ADD_REMOTE = false;
let REACTION_HANDLER_REMOVE_REMOTE = false;
let REACTION_HANDLER_REMOVE_REMOTE_ALL = false;
let ROOM_SYNC_GET_MXID_INVITES = new Set<string>();
let USER_SYNC_SET_ROOM_OVERRIDE = "";
let ROOMSYNC_MAYBE_LEAVE_GHOST = "";
let ROOMSYNC_ADD_GHOSTS = {} as any;
let DELAYED_FUNCTION_SET = async () => {};
function getHandler(opts?: IHandlerOpts) {
	if (!opts) {
		opts = {};
	}
	PRESENCE_HANDLER_SET = "";
	PRESENCE_HANDLER_SET_STATUS = "";
	TYPING_HANDLER_SET = "";
	EVENT_STORE_INSERT = "";
	BRIDGE_REDACT_EVENT = "";
	REACTION_HANDLER_ADD_REMOTE = false;
	REACTION_HANDLER_REMOVE_REMOTE = false;
	REACTION_HANDLER_REMOVE_REMOTE_ALL = false;
	ROOM_SYNC_GET_MXID_INVITES = new Set<string>();
	USER_SYNC_SET_ROOM_OVERRIDE = "";
	ROOMSYNC_MAYBE_LEAVE_GHOST = "";
	ROOMSYNC_ADD_GHOSTS = {};
	DELAYED_FUNCTION_SET = async () => {};
	const bridge = {
		protocol: {
			id: "remote",
			features: {
				presence: opts.enablePresence,
			},
		},
		config: {
			presence: {
				enabled: opts.enablePresence,
			},
		},
		hooks: { },
		namespaceHandler: {
			isMessageBlocked: async (params) => {
				return Boolean(opts!.blockMessage);
			},
		},
		redactEvent: async (client, roomId, eventId) => {
			BRIDGE_REDACT_EVENT = `${roomId};${eventId}`;
		},
		uploadContent: async (client, buffer, mimetype, name) => "mxc://newfile/example.org",
		botIntent: getIntent("@_puppet_bot:example.org"),
		AS: {
			isNamespacedUser: (userId) => userId.startsWith("@_puppet"),
			getIntentForUserId: (userId) => getIntent(userId),
		},
		userSync: {
			getPuppetClient: async (puppetId) => {
				if (!opts!.doublePuppeting) {
					return null;
				}
				return getClient("@user:example.org");
			},
			maybeGetClient: async (user) => {
				if (user.puppetId === 1 && user.userId === "fox") {
					return getClient("@_puppet_1_fox:example.org");
				}
				return null;
			},
			getClient: async (user) => {
				if (user.userId === "puppet" && opts!.doublePuppeting) {
					return getClient("@user:example.org");
				}
				return getClient(`@_puppet_${user.puppetId}_${user.userId}:example.org`);
			},
			setRoomOverride: async (user, roomId) => {
				USER_SYNC_SET_ROOM_OVERRIDE = `${user.userId};${roomId}`;
			},
		},
		roomSync: {
			maybeGetMxid: async (room) => {
				if (room.puppetId === 1 && room.roomId === "foxhole") {
					return "!someroom:example.org";
				}
				return null;
			},
			getMxid: async (room, client, invites, doCreate = true) => {
				ROOM_SYNC_GET_MXID_INVITES = invites;
				if (!doCreate) {
					if (room.puppetId === 1 && room.roomId === "foxhole") {
						return {
							mxid: "!someroom:example.org",
							created: false,
						};
					}
					return {
						mxid: "",
						created: false,
					};
				}
				return {
					mxid: "!someroom:example.org",
					created: room.roomId === "newfoxhole" || opts!.roomCreated,
				};
			},
			getRoomOp: async (roomId) => getClient("@_puppet_1_op:example.org"),
			maybeLeaveGhost: async (roomId, userId) => {
				ROOMSYNC_MAYBE_LEAVE_GHOST = `${userId};${roomId}`;
			},
			addGhosts: (room) => {
				ROOMSYNC_ADD_GHOSTS = room;
			},
		},
		presenceHandler: {
			set: async (userId, presence) => {
				PRESENCE_HANDLER_SET = `${userId};${presence}`;
			},
			setStatus: async (userId, status) => {
				PRESENCE_HANDLER_SET_STATUS = `${userId};${status}`;
			},
		},
		typingHandler: {
			set: async (userId, mxid, typing) => {
				TYPING_HANDLER_SET = `${userId};${mxid};${typing}`;
			},
		},
		eventSync: {
			getMatrix: async (puppetId, eventId) => {
				if (eventId === "foxparty") {
					return ["$foxparty"];
				}
				return [];
			},
			insert: async (puppetId, matrixId, remoteId) => {
				EVENT_STORE_INSERT = `${puppetId};${matrixId};${remoteId}`;
			},
		},
		reactionHandler: {
			addRemote: async (params, eventId, key, client, mxid) => {
				REACTION_HANDLER_ADD_REMOTE = true;
			},
			removeRemote: async (params, eventId, key, client, mxid) => {
				REACTION_HANDLER_REMOVE_REMOTE = true;
			},
			removeRemoteAllOnMessage: async (params, eventId, client, mxid) => {
				REACTION_HANDLER_REMOVE_REMOTE_ALL = true;
			},
		},
		provisioner: {
			get: async (puppetId) => {
				if (puppetId === 1) {
					return {
						puppetMxid: "@user:example.org",
						userId: "puppet",
						autoinvite: !opts!.noautoinvite,
					};
				}
				return null;
			},
		},
		delayedFunction: {
			set: (key, fn, timeout, opt) => {
				DELAYED_FUNCTION_SET = fn;
			},
		},
	} as any;
	const RemoteEventHandler = proxyquire.load("../src/remoteeventhandler", {
		"./util": { Util: {
			DownloadFile: async (url) => Buffer.from(url),
			GetMimeType: (buffer) => buffer.toString(),
		}},
	}).RemoteEventHandler;
	return new RemoteEventHandler(bridge);
}

describe("RemoteEventHandler", () => {
	describe("setUserPresence", () => {
		it("should do nothing, if the feature is disabled", async () => {
			const handler = getHandler();
			const user = {
				userId: "fox",
				puppetId: 1,
			} as any;
			await handler.setUserPresence(user, "online");
			expect(PRESENCE_HANDLER_SET).to.equal("");
		});
		it("should do nothing, if the user is not found", async () => {
			const handler = getHandler({ enablePresence: true });
			const user = {
				userId: "nofox",
				puppetId: 1,
			} as any;
			await handler.setUserPresence(user, "online");
			expect(PRESENCE_HANDLER_SET).to.equal("");
		});
		it("should set presence, if all checks out", async () => {
			const handler = getHandler({ enablePresence: true });
			const user = {
				userId: "fox",
				puppetId: 1,
			} as any;
			await handler.setUserPresence(user, "online");
			expect(PRESENCE_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;online");
		});
	});
	describe("setUserStatus", () => {
		it("should do nothing, if the feature is disabled", async () => {
			const handler = getHandler();
			const user = {
				userId: "fox",
				puppetId: 1,
			} as any;
			await handler.setUserStatus(user, "online");
			expect(PRESENCE_HANDLER_SET_STATUS).to.equal("");
		});
		it("should do nothing, if the user is not found", async () => {
			const handler = getHandler({ enablePresence: true });
			const user = {
				userId: "nofox",
				puppetId: 1,
			} as any;
			await handler.setUserStatus(user, "online");
			expect(PRESENCE_HANDLER_SET_STATUS).to.equal("");
		});
		it("should set the status, if all checks out", async () => {
			const handler = getHandler({ enablePresence: true });
			const user = {
				userId: "fox",
				puppetId: 1,
			} as any;
			await handler.setUserStatus(user, "online");
			expect(PRESENCE_HANDLER_SET_STATUS).to.equal("@_puppet_1_fox:example.org;online");
		});
	});
	describe("SetUserTyping", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			await handler.setUserTyping(params, true);
			expect(TYPING_HANDLER_SET).to.equal("");
		});
		it("should do nothing, if the user/room isn't found", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => null;
			const params = {
				user: {
					userId: "nofox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler.setUserTyping(params, true);
			expect(TYPING_HANDLER_SET).to.equal("");
		});
		it("should set typing, if all checks out", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler.setUserTyping(params, true);
			expect(TYPING_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;!someroom:example.org;true");
		});
	});
	describe("sendReadReceipt", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "foxparty",
			} as any;
			await handler.sendReadReceipt(params);
			expect(CLIENT_SEND_READ_RECEIPT).to.equal("");
		});
		it("should do nothing, if the user/room isn't found", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => null;
			const params = {
				user: {
					userId: "nofox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "foxparty",
			} as any;
			await handler.sendReadReceipt(params);
			expect(CLIENT_SEND_READ_RECEIPT).to.equal("");
		});
		it("should do nothing, if no event ID is set", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler.sendReadReceipt(params);
			expect(CLIENT_SEND_READ_RECEIPT).to.equal("");
		});
		it("should do nothing, if the set event ID isn't found", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "nonexistant",
			} as any;
			await handler.sendReadReceipt(params);
			expect(CLIENT_SEND_READ_RECEIPT).to.equal("");
		});
		it("should send the read reciept, should all check out", async () => {
			const handler = getHandler();
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "foxparty",
			} as any;
			await handler.sendReadReceipt(params);
			expect(CLIENT_SEND_READ_RECEIPT).to.equal("!someroom:example.org;$foxparty");
		});
	});
	describe("addUser", () => {
		it("should do nothing, if the room isn't found", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "nofoxhole",
					puppetId: 1,
				},
			} as any;
			await handler.addUser(params);
			expect(INTENT_REGISTERED_AND_JOINED).to.equal("");
		});
		it("should add the user, should all check out", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler.addUser(params);
			expect(INTENT_REGISTERED_AND_JOINED).to.equal("!someroom:example.org");
		});
	});
	describe("removeUser", () => {
		it("should do nothing, if the stuff isn't found", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			handler["maybePrepareSend"] = async (_) => null;
			await handler.removeUser(params);
			expect(INTENT_LEAVE_ROOM).to.equal("");
		});
		it("should remove the user, should all check out", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			handler["maybePrepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			await handler.removeUser(params);
			expect(INTENT_LEAVE_ROOM).to.equal("!someroom:example.org");
		});
	});
	describe("sendMessage", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendMessage(params, msg);
			expect(CLIENT_SEND_MESSAGE).eql({});
		});
		it("should send a plain message", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendMessage(params, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.text",
				body: "Hey there!",
				source: "remote",
			});
		});
		it("should send notice and emote messages", async () => {
			for (const type of ["notice", "emote"]) {
				const handler = getHandler();
				handler["prepareSend"] = async (_) => {
					return {
						client: getClient("@_puppet_1_fox:example.org"),
						mxid: "!someroom:example.org",
					};
				};
				const params = {
					user: {
						userId: "fox",
						puppetId: 1,
					},
					room: {
						roomId: "foxhole",
						puppetId: 1,
					},
				} as any;
				const msg = {
					body: "Hey there!",
				} as any;
				msg[type] = true;
				await handler.sendMessage(params, msg);
				expect(CLIENT_SEND_MESSAGE).eql({
					msgtype: "m." + type,
					body: "Hey there!",
					source: "remote",
				});
			}
		});
		it("should send a formatted body, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const msg = {
				body: "Hey there!",
				formattedBody: "<strong>Hey there!</strong>",
			} as any;
			await handler.sendMessage(params, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.text",
				body: "Hey there!",
				source: "remote",
				format: "org.matrix.custom.html",
				formatted_body: "<strong>Hey there!</strong>",
			});
		});
		it("should set an external URL, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				externalUrl: "https://example.org",
			} as any;
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendMessage(params, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.text",
				body: "Hey there!",
				source: "remote",
				external_url: "https://example.org",
			});
		});
		it("should associate the new event ID, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "newevent",
			} as any;
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendMessage(params, msg);
			expect(EVENT_STORE_INSERT).to.equal("1;$newevent;newevent");
		});
		it("should stop the typing indicator", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendMessage(params, msg);
			expect(TYPING_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;!someroom:example.org;false");
		});
	});
	describe("sendEdit", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({});
		});
		it("should send a plain edit", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"body": "* Hey there!",
				"source": "remote",
				"m.new_content": {
					msgtype: "m.text",
					body: "Hey there!",
				},
				"m.relates_to": {
					event_id: "$foxparty",
					rel_type: "m.replace",
				},
			});
		});
		it("should send notice and emote edits", async () => {
			for (const type of ["notice", "emote"]) {
				const handler = getHandler();
				handler["prepareSend"] = async (_) => {
					return {
						client: getClient("@_puppet_1_fox:example.org"),
						mxid: "!someroom:example.org",
					};
				};
				const params = {
					user: {
						userId: "fox",
						puppetId: 1,
					},
					room: {
						roomId: "foxhole",
						puppetId: 1,
					},
				} as any;
				const eventId = "foxparty";
				const msg = {
					body: "Hey there!",
				} as any;
				msg[type] = true;
				await handler.sendEdit(params, eventId, msg);
				expect(CLIENT_SEND_MESSAGE).eql({
					"msgtype": "m." + type,
					"body": "* Hey there!",
					"source": "remote",
					"m.new_content": {
						msgtype: "m." + type,
						body: "Hey there!",
					},
					"m.relates_to": {
						event_id: "$foxparty",
						rel_type: "m.replace",
					},
				});
			}
		});
		it("should send a formatted body, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
				formattedBody: "<strong>Hey there!</strong>",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"source": "remote",
				"body": "* Hey there!",
				"format": "org.matrix.custom.html",
				"formatted_body": "* <strong>Hey there!</strong>",
				"m.new_content": {
					msgtype: "m.text",
					body: "Hey there!",
					format: "org.matrix.custom.html",
					formatted_body: "<strong>Hey there!</strong>",
				},
				"m.relates_to": {
					event_id: "$foxparty",
					rel_type: "m.replace",
				},
			});
		});
		it("should set an external URL, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				externalUrl: "https://example.org",
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"source": "remote",
				"body": "* Hey there!",
				"external_url": "https://example.org",
				"m.new_content": {
					msgtype: "m.text",
					body: "Hey there!",
					external_url: "https://example.org",
				},
				"m.relates_to": {
					event_id: "$foxparty",
					rel_type: "m.replace",
				},
			});
		});
		it("should associate the new event ID, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "newevent",
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(EVENT_STORE_INSERT).to.equal("1;$newevent;newevent");
		});
		it("should fall back to normal messages, if the remote event isn't found", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "nonexistant";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"body": "* Hey there!",
				"source": "remote",
				"m.new_content": {
					msgtype: "m.text",
					body: "Hey there!",
				},
			});
		});
		it("should stop the typing indicator", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendEdit(params, eventId, msg);
			expect(TYPING_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;!someroom:example.org;false");
		});
	});
	describe("sendRedact", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			await handler.sendRedact(params, eventId);
			expect(BRIDGE_REDACT_EVENT).to.equal("");
		});
		it("should do nothing, if no remote events are found", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "nonexistant";
			await handler.sendRedact(params, eventId);
			expect(BRIDGE_REDACT_EVENT).to.equal("");
		});
		it("should redact an associated event", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			await handler.sendRedact(params, eventId);
			expect(BRIDGE_REDACT_EVENT).to.equal("!someroom:example.org;$foxparty");
		});
	});
	describe("sendReply", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({});
		});
		it("should send a plain reply", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"source": "remote",
				"body": "Hey there!",
				"m.relates_to": {
					"m.in_reply_to": {
						event_id: "$foxparty",
					},
				},
			});
		});
		it("should send notice and emote replies", async () => {
			for (const type of ["notice", "emote"]) {
				const handler = getHandler();
				handler["prepareSend"] = async (_) => {
					return {
						client: getClient("@_puppet_1_fox:example.org"),
						mxid: "!someroom:example.org",
					};
				};
				const params = {
					user: {
						userId: "fox",
						puppetId: 1,
					},
					room: {
						roomId: "foxhole",
						puppetId: 1,
					},
				} as any;
				const eventId = "foxparty";
				const msg = {
					body: "Hey there!",
				} as any;
				msg[type] = true;
				await handler.sendReply(params, eventId, msg);
				expect(CLIENT_SEND_MESSAGE).eql({
					"msgtype": "m." + type,
					"source": "remote",
					"body": "Hey there!",
					"m.relates_to": {
						"m.in_reply_to": {
							event_id: "$foxparty",
						},
					},
				});
			}
		});
		it("should send a formatted body, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
				formattedBody: "<strong>Hey there!</strong>",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"source": "remote",
				"body": "Hey there!",
				"format": "org.matrix.custom.html",
				"formatted_body": "<strong>Hey there!</strong>",
				"m.relates_to": {
					"m.in_reply_to": {
						event_id: "$foxparty",
					},
				},
			});
		});
		it("should set an external URL, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				externalUrl: "https://example.org",
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				"msgtype": "m.text",
				"source": "remote",
				"body": "Hey there!",
				"external_url": "https://example.org",
				"m.relates_to": {
					"m.in_reply_to": {
						event_id: "$foxparty",
					},
				},
			});
		});
		it("should associate the new event ID, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "newevent",
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(EVENT_STORE_INSERT).to.equal("1;$newevent;newevent");
		});
		it("should fall back to normal messages, if the remote event isn't found", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "nonexistant";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.text",
				body: "Hey there!",
				source: "remote",
			});
		});
		it("should stop the typing indicator", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const msg = {
				body: "Hey there!",
			} as any;
			await handler.sendReply(params, eventId, msg);
			expect(TYPING_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;!someroom:example.org;false");
		});
	});
	describe("sendReaction", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const key = "fox";
			await handler.sendReaction(params, eventId, key);
			expect(REACTION_HANDLER_ADD_REMOTE).to.be.false;
		});
		it("should pass the request on to the reaction handler", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const key = "fox";
			await handler.sendReaction(params, eventId, key);
			expect(REACTION_HANDLER_ADD_REMOTE).to.be.true;
		});
	});
	describe("removeReaction", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const key = "fox";
			await handler.removeReaction(params, eventId, key);
			expect(REACTION_HANDLER_REMOVE_REMOTE).to.be.false;
		});
		it("should pass the request on to the reaction handler", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			const key = "fox";
			await handler.removeReaction(params, eventId, key);
			expect(REACTION_HANDLER_REMOVE_REMOTE).to.be.true;
		});
	});
	describe("removeAllReactions", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			await handler.removeAllReactions(params, eventId);
			expect(REACTION_HANDLER_REMOVE_REMOTE_ALL).to.be.false;
		});
		it("should pass the request on to the reaction handler", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const eventId = "foxparty";
			await handler.removeAllReactions(params, eventId);
			expect(REACTION_HANDLER_REMOVE_REMOTE_ALL).to.be.true;
		});
	});
	describe("sendFileByType", () => {
		it("should do nothing, if the thing is blocked", async () => {
			const handler = getHandler({
				blockMessage: true,
			});
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const thing = Buffer.from("myfile");
			await handler.sendFileByType("m.file", params, thing);
			expect(CLIENT_SEND_MESSAGE).eql({});
		});
		it("should send a file by msgtype", async () => {
			for (const msgtype of ["m.file", "m.image", "m.audio", "m.video"]) {
				const handler = getHandler();
				handler["prepareSend"] = async (_) => {
					return {
						client: getClient("@_puppet_1_fox:example.org"),
						mxid: "!someroom:example.org",
					};
				};
				const params = {
					user: {
						userId: "fox",
						puppetId: 1,
					},
					room: {
						roomId: "foxhole",
						puppetId: 1,
					},
				} as any;
				const thing = Buffer.from("myfile");
				await handler.sendFileByType(msgtype, params, thing);
				expect(CLIENT_SEND_MESSAGE).eql({
					msgtype,
					source: "remote",
					body: "remote_file",
					url: "mxc://newfile/example.org",
					info: {
						mimetype: "myfile",
						size: 6,
					},
				});
			}
		});
		it("should autodetect the type, if specified", async () => {
			for (const type of ["file", "audio", "image", "video"]) {
				const handler = getHandler();
				handler["prepareSend"] = async (_) => {
					return {
						client: getClient("@_puppet_1_fox:example.org"),
						mxid: "!someroom:example.org",
					};
				};
				const params = {
					user: {
						userId: "fox",
						puppetId: 1,
					},
					room: {
						roomId: "foxhole",
						puppetId: 1,
					},
				} as any;
				const thing = Buffer.from(type + "/blah");
				await handler.sendFileByType("detect", params, thing);
				expect(CLIENT_SEND_MESSAGE).eql({
					msgtype: "m." + type,
					source: "remote",
					body: "remote_file",
					url: "mxc://newfile/example.org",
					info: {
						mimetype: type + "/blah",
						size: type.length + 5,
					},
				});
			}
		});
		it("should download a remote URL and set external_url, if set", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const thing = "image/jpeg";
			await handler.sendFileByType("detect", params, thing);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.image",
				source: "remote",
				body: "remote_file",
				external_url: "image/jpeg",
				url: "mxc://newfile/example.org",
				info: {
					mimetype: "image/jpeg",
					size: 10,
				},
			});
		});
		it("should set a custom external URL, if set", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				externalUrl: "https://example.org",
			} as any;
			const thing = "image/jpeg";
			await handler.sendFileByType("detect", params, thing);
			expect(CLIENT_SEND_MESSAGE).eql({
				msgtype: "m.image",
				source: "remote",
				body: "remote_file",
				external_url: "https://example.org",
				url: "mxc://newfile/example.org",
				info: {
					mimetype: "image/jpeg",
					size: 10,
				},
			});
		});
		it("should associate an event ID, if present", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
				eventId: "newevent",
			} as any;
			const thing = "image/jpeg";
			await handler.sendFileByType("detect", params, thing);
			expect(EVENT_STORE_INSERT).to.equal("1;$newevent;newevent");
		});
		it("should stop the typing indicator", async () => {
			const handler = getHandler();
			handler["prepareSend"] = async (_) => {
				return {
					client: getClient("@_puppet_1_fox:example.org"),
					mxid: "!someroom:example.org",
				};
			};
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const thing = Buffer.from("myfile");
			await handler.sendFileByType("m.file", params, thing);
			expect(TYPING_HANDLER_SET).to.equal("@_puppet_1_fox:example.org;!someroom:example.org;false");
		});
	});
	describe("maybePrepareSend", () => {
		it("should return null if the room isn't found", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "nonexistant",
					puppetId: 1,
				},
			} as any;
			const ret = await handler["maybePrepareSend"](params);
			expect(ret).to.be.null;
		});
		it("should return null if the user isn't found", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "nonexistant",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const ret = await handler["maybePrepareSend"](params);
			expect(ret).to.be.null;
		});
		it("should return client and mxid, if both are found", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const ret = await handler["maybePrepareSend"](params);
			expect(ret.mxid).to.equal("!someroom:example.org");
			expect(await ret.client.getUserId()).to.equal("@_puppet_1_fox:example.org");
		});
	});
	describe("prepareSend", () => {
		it("should return the mxid and the client", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			const ret = await handler["prepareSend"](params);
			expect(ret.mxid).to.equal("!someroom:example.org");
			expect(await ret.client.getUserId()).to.equal("@_puppet_1_fox:example.org");
		});
		it("should not set the puppet to be invited to a newly created room, if unset", async () => {
			const handler = getHandler({
				noautoinvite: true,
			});
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "newfoxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(ROOM_SYNC_GET_MXID_INVITES.has("@user:example.org")).to.be.false;
		});
		it("should add the ghosts on newly created rooms", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "newfoxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(ROOMSYNC_ADD_GHOSTS).to.eql({
				roomId: "newfoxhole",
				puppetId: 1,
			});
		});
		it("should join the ghost to rooms", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(INTENT_REGISTERED_AND_JOINED).to.equal("!someroom:example.org");
		});
		it("should apply room overrides for the ghost, if the room just got created", async () => {
			const handler = getHandler({
				roomCreated: true,
			});
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "newfoxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(USER_SYNC_SET_ROOM_OVERRIDE).to.equal("fox;newfoxhole");
		});
		it("should delay-leave the ghost of the puppet", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "puppet",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			await DELAYED_FUNCTION_SET();
			expect(ROOMSYNC_MAYBE_LEAVE_GHOST).to.equal("@_puppet_1_puppet:example.org;!someroom:example.org");
		});
		it("should invite the puppet", async () => {
			const handler = getHandler();
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(CLIENT_INVITE_USER).to.equal("@user:example.org;!someroom:example.org");
		});
		it("should auto-join the room, if double-puppeting is enabled", async () => {
			const handler = getHandler({
				doublePuppeting: true,
			});
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(CLIENT_JOIN_ROOM).to.equal("!someroom:example.org");
		});
		it("should not invite the puppet, if set", async () => {
			const handler = getHandler({noautoinvite: true});
			const params = {
				user: {
					userId: "fox",
					puppetId: 1,
				},
				room: {
					roomId: "foxhole",
					puppetId: 1,
				},
			} as any;
			await handler["prepareSend"](params);
			expect(CLIENT_INVITE_USER).to.equal("");
		});
	});
});
