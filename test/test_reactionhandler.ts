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
import { ReactionHandler } from "../src/reactionhandler";
import { RedactionEvent } from "matrix-bot-sdk";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

let CLIENT_SEND_EVENT = {} as any;
let CLIENT_SEND_EVENT_TYPE = "";
function getClient() {
	CLIENT_SEND_EVENT = {};
	CLIENT_SEND_EVENT_TYPE = "";
	return {
		sendEvent: async (roomId, type, msg) => {
			CLIENT_SEND_EVENT_TYPE = type;
			CLIENT_SEND_EVENT = msg;
			return "$newevent";
		},
	} as any;
}

let EVENT_STORE_INSERT = "";
let REACTION_STORE_INSERT = {} as any;
let REACTION_STORE_DELETE = "";
let REACTION_STORE_DELETE_FOR_EVENT = "";
let BRIDGE_REDACT_EVENT = "";
let BRIDGE_EVENTS_EMITTED: any[] = [];
function getHandler() {
	EVENT_STORE_INSERT = "";
	REACTION_STORE_INSERT = {};
	REACTION_STORE_DELETE = "";
	REACTION_STORE_DELETE_FOR_EVENT = "";
	BRIDGE_REDACT_EVENT = "";
	BRIDGE_EVENTS_EMITTED = [];
	const bridge = {
		protocol: {
			id: "remote",
		},
		emit: (type) => {
			BRIDGE_EVENTS_EMITTED.push(type);
		},
		redactEvent: async (client, roomId, eventId) => {
			BRIDGE_REDACT_EVENT = `${roomId};${eventId}`;
		},
		reactionStore: {
			exists: async (entry) => entry.roomId === "foxhole" && entry.userId === "fox"
				&& entry.key === "fox" && entry.eventId === "foxparty",
			getFromKey: async (entry) => {
				if (entry.roomId === "foxhole" && entry.userId === "fox" && entry.key === "fox" && entry.eventId === "foxparty") {
					return {
						puppetId: 1,
						roomId: "foxhole",
						userId: "fox",
						key: "fox",
						eventId: "foxparty",
						reactionMxid: "$oldreaction",
					};
				}
				return null;
			},
			getForEvent: async (puppetId, eventId) => {
				if (eventId === "foxparty") {
					return [{
						puppetId: 1,
						roomId: "foxhole",
						userId: "fox",
						key: "fox",
						eventId: "foxparty",
						reactionMxid: "$oldreaction",
					}];
				}
				return [];
			},
			insert: async (entry) => {
				REACTION_STORE_INSERT = entry;
			},
			delete: async (reactionMxid) => {
				REACTION_STORE_DELETE = reactionMxid;
			},
			deleteForEvent: async (puppetId, eventId) => {
				REACTION_STORE_DELETE_FOR_EVENT = `${puppetId};${eventId}`;
			},
			getFromReactionMxid: async (reactionMxid) => {
				if (reactionMxid === "$oldreaction") {
					return {
						puppetId: 1,
						roomId: "foxhole",
						userId: "fox",
						key: "fox",
						eventId: "foxparty",
						reactionMxid: "$oldreaction",
					};
				}
				return null;
			},
		},
		eventStore: {
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
		provisioner: {
			get: async (puppetId) => {
				if (puppetId === 1) {
					return {
						userId: "puppet",
					};
				}
				return null;
			},
		},
	} as any;
	return new ReactionHandler(bridge);
}

describe("ReactionHandler", () => {
	describe("addRemote", () => {
		it("should ignore if no event is found", async () => {
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
			const eventId = "nonexistant";
			const key = "newfox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.addRemote(params, eventId, key, client, mxid);
			expect(CLIENT_SEND_EVENT).eql({});
		});
		it("should ignore if the reaction already exists", async () => {
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
			const eventId = "foxparty";
			const key = "fox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.addRemote(params, eventId, key, client, mxid);
			expect(CLIENT_SEND_EVENT).eql({});
		});
		it("shoud send, should all check out", async () => {
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
			const eventId = "foxparty";
			const key = "newfox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.addRemote(params, eventId, key, client, mxid);
			expect(CLIENT_SEND_EVENT_TYPE).to.equal("m.reaction");
			expect(CLIENT_SEND_EVENT).eql({
				"source": "remote",
				"m.relates_to": {
					rel_type: "m.annotation",
					event_id: "$foxparty",
					key: "newfox",
				},
			});
			expect(REACTION_STORE_INSERT).eql({
				puppetId: 1,
				roomId: "foxhole",
				userId: "fox",
				eventId: "foxparty",
				reactionMxid: "$newevent",
				key: "newfox",
			});
		});
		it("should associate a remote event id, if present", async () => {
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
				eventId: "reactevent",
			} as any;
			const eventId = "foxparty";
			const key = "newfox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.addRemote(params, eventId, key, client, mxid);
			expect(EVENT_STORE_INSERT).to.equal("1;$newevent;reactevent");
		});
		it("should set an external url, if present", async () => {
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
				externalUrl: "https://example.org",
			} as any;
			const eventId = "foxparty";
			const key = "newfox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.addRemote(params, eventId, key, client, mxid);
			expect(CLIENT_SEND_EVENT_TYPE).to.equal("m.reaction");
			expect(CLIENT_SEND_EVENT).eql({
				"source": "remote",
				"m.relates_to": {
					rel_type: "m.annotation",
					event_id: "$foxparty",
					key: "newfox",
				},
				"external_url": "https://example.org",
			});
		});
	});
	describe("removeRemote", () => {
		it("should ignore if event is not found", async () => {
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
			const eventId = "nonexistant";
			const key = "fox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.removeRemote(params, eventId, key, client, mxid);
			expect(BRIDGE_REDACT_EVENT).to.equal("");
		});
		it("should ignore, if the key doesn't exist", async () => {
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
			const eventId = "foxparty";
			const key = "newfox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.removeRemote(params, eventId, key, client, mxid);
			expect(BRIDGE_REDACT_EVENT).to.equal("");
		});
		it("should redact, should all check out", async () => {
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
			const eventId = "foxparty";
			const key = "fox";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.removeRemote(params, eventId, key, client, mxid);
			expect(BRIDGE_REDACT_EVENT).to.equal("!someroom:example.org;$oldreaction");
			expect(REACTION_STORE_DELETE).to.equal("$oldreaction");
		});
	});
	describe("removeRemoteAllOnMessage", () => {
		it("should ignore if event is not found", async () => {
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
			const eventId = "nonexistant";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.removeRemoteAllOnMessage(params, eventId, client, mxid);
			expect(BRIDGE_REDACT_EVENT).to.equal("");
		});
		it("should redact, should everything check out", async () => {
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
			const eventId = "foxparty";
			const client = getClient();
			const mxid = "!someroom:example.org";
			await handler.removeRemoteAllOnMessage(params, eventId, client, mxid);
			expect(BRIDGE_REDACT_EVENT).to.equal("!someroom:example.org;$oldreaction");
			expect(REACTION_STORE_DELETE_FOR_EVENT).to.equal("1;foxparty");
		});
	});
	describe("addMatrix", () => {
		it("should ignore if the remote puppet doesn't have a user id", async () => {
			const handler = getHandler();
			const room = {
				roomId: "foxhole",
				puppetId: 42,
			};
			const eventId = "foxparty";
			const reactionMxid = "$newreaction";
			const key = "fox";
			await handler.addMatrix(room, eventId, reactionMxid, key);
			expect(REACTION_STORE_INSERT).eql({});
		});
		it("should insert the event to the store, should all be fine", async () => {
			const handler = getHandler();
			const room = {
				roomId: "foxhole",
				puppetId: 1,
			};
			const eventId = "foxparty";
			const reactionMxid = "$newreaction";
			const key = "fox";
			await handler.addMatrix(room, eventId, reactionMxid, key);
			expect(REACTION_STORE_INSERT).eql({
				puppetId: 1,
				roomId: "foxhole",
				userId: "puppet",
				eventId,
				reactionMxid,
				key,
			});
		});
	});
	describe("handleRedactEvent", () => {
		it("should do nothing, if the event isn't found", async () => {
			const handler = getHandler();
			const room = {
				roomId: "foxhole",
				puppetId: 1,
			};
			const event = new RedactionEvent({
				redacts: "$nonexisting",
			});
			await handler.handleRedactEvent(room, event, null);
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
			expect(REACTION_STORE_DELETE).to.equal("");
		});
		it("should do nothing, if the room doesn't match", async () => {
			const handler = getHandler();
			const room = {
				roomId: "foxmeadow",
				puppetId: 1,
			};
			const event = new RedactionEvent({
				redacts: "$oldreaction",
			});
			await handler.handleRedactEvent(room, event, null);
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
			expect(REACTION_STORE_DELETE).to.equal("");
		});
		it("should redact the event, is all fine", async () => {
			const handler = getHandler();
			const room = {
				roomId: "foxhole",
				puppetId: 1,
			};
			const event = new RedactionEvent({
				redacts: "$oldreaction",
			});
			await handler.handleRedactEvent(room, event, null);
			expect(BRIDGE_EVENTS_EMITTED).eql(["removeReaction"]);
			expect(REACTION_STORE_DELETE).to.equal("$oldreaction");
		});
	});
});
