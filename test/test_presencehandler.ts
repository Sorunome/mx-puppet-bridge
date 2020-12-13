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
import { PresenceHandler } from "../src/presencehandler";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

let CLIENT_REQUEST_METHOD = "";
let CLIENT_REQUEST_URL = "";
let CLIENT_REQUEST_DATA = {} as any;
let CLIENT_STATE_EVENT_TYPE = "";
let CLIENT_STATE_EVENT_KEY = "";
let CLIENT_STATE_EVENT_DATA = {} as any;
function getClient(userId) {
	CLIENT_REQUEST_METHOD = "";
	CLIENT_REQUEST_URL = "";
	CLIENT_REQUEST_DATA = {};
	CLIENT_STATE_EVENT_TYPE = "";
	CLIENT_STATE_EVENT_KEY = "";
	CLIENT_STATE_EVENT_DATA = {};
	return {
		getUserId: async () => userId,
		doRequest: async (method, url, qs, data) => {
			CLIENT_REQUEST_METHOD = method;
			CLIENT_REQUEST_URL = url;
			CLIENT_REQUEST_DATA = data;
		},
		sendStateEvent: async (roomId, type, key, data) => {
			CLIENT_STATE_EVENT_TYPE = type;
			CLIENT_STATE_EVENT_KEY = key;
			CLIENT_STATE_EVENT_DATA = data;
		},
	};
}

let INTENT_ENSURE_REGISTERED = false;
function getIntent(userId) {
	INTENT_ENSURE_REGISTERED = false;
	return {
		ensureRegistered: async () => {
			INTENT_ENSURE_REGISTERED = true;
		},
		underlyingClient: getClient(userId),
	};
}

function getHandler(config: any = {}) {
	CLIENT_STATE_EVENT_TYPE = "";
	CLIENT_STATE_EVENT_KEY = "";
	CLIENT_STATE_EVENT_DATA = {};
	config = Object.assign({
		enabled: true,
		interval: 500,
		enableStatusState: false,
		statusStateBlacklist: [],
	}, config);
	const bridge = {
		AS: {
			isNamespacedUser: (userId) => userId.startsWith("@_puppet"),
			getIntentForUserId: (userId) => getIntent(userId),
		},
		botIntent: { userId: "@_puppet_bot:example.org" },
		puppetStore: {
			getRoomsOfGhost: async (mxid) => {
				if (mxid === "@_puppet_1_fox:example.org") {
					return ["!room1:example.org", "!room2:example.org"];
				}
				return [];
			},
		},
		userSync: {
			getPartsFromMxid: (mxid) => {
				return {
					puppetId: 1,
					userId: mxid.split("_")[3].split(":")[0],
				};
			},
		},
	} as any;
	return new PresenceHandler(bridge, config);
}

let originalDateNow: any;
const MOCK_DATE = 100 * 1000;

describe("PresenceHandler", () => {
	beforeEach(() => {
		originalDateNow = Date.now;
		Date.now = () => {
			return MOCK_DATE;
		};
	});

	afterEach(() => {
		Date.now = originalDateNow;
	});

	describe("set", () => {
		it("should ignore users not handled", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			handler.set("@user:example.org", "online");
			expect(presenceSet).to.be.false;
		});
		it("should set presence and push to the presence queue", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			handler.set("@_puppet_1_fox:example.org", "online");
			expect(presenceSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				presence: "online",
				last_sent: MOCK_DATE,
			});
		});
		it("should update presence, should it already exist", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			handler.set("@_puppet_1_fox:example.org", "online");
			handler.set("@_puppet_1_fox:example.org", "unavailable");
			expect(presenceSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				presence: "unavailable",
				last_sent: MOCK_DATE,
			});
		});
	});
	describe("setStatus", () => {
		it("should ignore users not handled", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			let statusSet = false;
			handler["setMatrixStatus"] = ((info) => {
				statusSet = true;
			}) as any;
			handler.setStatus("@user:example.org", "fox");
			expect(presenceSet).to.be.false;
			expect(statusSet).to.be.false;
		});
		it("should set status and push to the presence queue", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			let statusSet = false;
			handler["setMatrixStatus"] = ((info) => {
				statusSet = true;
			}) as any;
			handler.setStatus("@_puppet_1_fox:example.org", "fox");
			expect(presenceSet).to.be.true;
			expect(statusSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				status: "fox",
				last_sent: MOCK_DATE,
			});
		});
		it("should update an status, should it already exist", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			let statusSet = false;
			handler["setMatrixStatus"] = ((info) => {
				statusSet = true;
			}) as any;
			handler.setStatus("@_puppet_1_fox:example.org", "fox");
			handler.setStatus("@_puppet_1_fox:example.org", "raccoon");
			expect(presenceSet).to.be.true;
			expect(statusSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				status: "raccoon",
				last_sent: Date.now(),
			});
		});
	});
	describe("setStatusInRoom", () => {
		it("should ignore users not handled", () => {
			const handler = getHandler();
			let statusSet = false;
			handler["setMatrixStatusInRoom"] = ((info) => {
				statusSet = true;
			}) as any;
			handler.setStatusInRoom("@user:example.org", "!someroom:example.org");
			expect(statusSet).to.be.false;
		});
		it("should ignore users not already found in the queue", () => {
			const handler = getHandler();
			let statusSet = false;
			handler["setMatrixStatusInRoom"] = ((info) => {
				statusSet = true;
			}) as any;
			handler.setStatusInRoom("@_puppet_1_fox:example.org", "!someroom:example.org");
			expect(statusSet).to.be.false;
		});
		it("should pass on the status, if all is OK", () => {
			const handler = getHandler();
			let statusSet = false;
			handler["setMatrixStatusInRoom"] = ((info) => {
				statusSet = true;
			}) as any;
			handler["presenceQueue"].push({
				mxid: "@_puppet_1_fox:example.org",
				status: "blah",
				last_sent: 0,
			});
			handler.setStatusInRoom("@_puppet_1_fox:example.org", "!someroom:example.org");
			expect(statusSet).to.be.true;
		});
	});
	describe("remove", () => {
		it("should set the mxid as offline", () => {
			const handler = getHandler();
			let setPresence = "";
			handler.set = (mxid, presence) => {
				setPresence = presence;
			};
			handler.remove("@_puppet_1_fox:example.org");
			expect(setPresence).to.equal("offline");
		});
	});
	describe("handled", () => {
		it("should ignore non-ghost users", () => {
			const handler = getHandler();
			const ret = handler["handled"]("@user:example.org");
			expect(ret).to.be.false;
		});
		it("should handle ghost users", () => {
			const handler = getHandler();
			const ret = handler["handled"]("@_puppet_1_fox:example.org");
			expect(ret).to.be.true;
		});
	});
	describe("processIntervalThread", () => {
		it("should pop and re-push non-offline users", async () => {
			const handler = getHandler();
			handler["presenceQueue"].push({
				mxid: "@_puppet_1_fox:example.org",
				presence: "online",
				last_sent: 0,
			});
			let setPresence = false;
			handler["setMatrixPresence"] = async (info) => {
				setPresence = true;
			};
			await handler["processIntervalThread"]();
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				presence: "online",
				last_sent: MOCK_DATE,
			});
			expect(setPresence).to.be.true;
		});
		it("should pop offline users from the queue", async () => {
			const handler = getHandler();
			handler["presenceQueue"].push({
				mxid: "@_puppet_1_fox:example.org",
				presence: "offline",
				last_sent: 0,
			});
			let setPresence = false;
			handler["setMatrixPresence"] = async (info) => {
				setPresence = true;
			};
			await handler["processIntervalThread"]();
			expect(handler["presenceQueue"].length).to.equal(0);
			expect(setPresence).to.be.true;
		});
		it("should ignore invalid entries", async () => {
			const handler = getHandler();
			handler["presenceQueue"].push(null as any);
			let setPresence = false;
			handler["setMatrixPresence"] = async (info) => {
				setPresence = true;
			};
			await handler["processIntervalThread"]();
			expect(handler["presenceQueue"].length).to.equal(0);
			expect(setPresence).to.be.false;
		});
		it("should not send fresh presence", async () => {
			const handler = getHandler();
			handler["presenceQueue"].push({
				mxid: "@_puppet_1_fox:example.org",
				presence: "online",
				last_sent: Date.now() - 1,
			});
			let setPresence = false;
			handler["setMatrixPresence"] = async (info) => {
				setPresence = true;
			};
			await handler["processIntervalThread"]();
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(setPresence).to.be.false;
		});
	});
	describe("setMatrixPresence", () => {
		it("should set present and status", async () => {
			const handler = getHandler();
			const info = {
				mxid: "@_puppet_1_fox:example.org",
				presence: "online",
				status: "fox!",
			} as any;
			await handler["setMatrixPresence"](info);
			expect(INTENT_ENSURE_REGISTERED).to.be.true;
			expect(CLIENT_REQUEST_METHOD).to.equal("PUT");
			expect(CLIENT_REQUEST_URL).to.equal("/_matrix/client/r0/presence/%40_puppet_1_fox%3Aexample.org/status");
			expect(CLIENT_REQUEST_DATA).eql({
				presence: "online",
				status_msg: "fox!",
			});
		});
	});
	describe("setMatrixStatus", () => {
		it("should fetch all rooms and pass responisbility on", async () => {
			const handler = getHandler();
			let roomCount = 0;
			handler["setMatrixStatusInRoom"] = async (_, roomId) => {
				roomCount++;
			};
			const info = {
				mxid: "@_puppet_1_fox:example.org",
				status: "Foxies!",
				last_sent: 0,
			};
			await handler["setMatrixStatus"](info);
			expect(roomCount).to.equal(2);
		});
	});
	describe("setMatrixStatusInRoom", () => {
		it("should ignore offline blank presence changes", async () => {
			const handler = getHandler({
				enableStatusState: true,
			});
			const info = {
				mxid: "@_puppet_1_fox:example.org",
				status: "",
				presence: "offline",
			} as any;
			const roomId = "!room:example.org";
			await handler["setMatrixStatusInRoom"](info, roomId);
			expect(CLIENT_STATE_EVENT_TYPE).to.equal("");
			expect(CLIENT_STATE_EVENT_KEY).to.equal("");
			expect(CLIENT_STATE_EVENT_DATA).eql({});
		});
		it("should set status state if setting is enabled", async () => {
			const handler = getHandler({
				enableStatusState: true,
			});
			const info = {
				mxid: "@_puppet_1_fox:example.org",
				status: "Foxies!",
				presence: "online",
			} as any;
			const roomId = "!room:example.org";
			await handler["setMatrixStatusInRoom"](info, roomId);
			expect(CLIENT_STATE_EVENT_TYPE).to.equal("im.vector.user_status");
			expect(CLIENT_STATE_EVENT_KEY).to.equal("@_puppet_1_fox:example.org");
			expect(CLIENT_STATE_EVENT_DATA).eql({
				status: "Foxies!",
			});
		});
		it("should not set status state if setting is not enabled", async () => {
			const handler = getHandler({
				enableStatusState: false,
			});
			const info = {
				mxid: "@_puppet_1_fox:example.org",
				status: "Foxies!",
				presence: "online",
			} as any;
			const roomId = "!room:example.org";
			await handler["setMatrixStatusInRoom"](info, roomId);
			expect(CLIENT_STATE_EVENT_TYPE).to.equal("");
			expect(CLIENT_STATE_EVENT_KEY).to.equal("");
			expect(CLIENT_STATE_EVENT_DATA).eql({});
		});
		it("should ignore if presence status user is blacklisted", async () => {
			const handler = getHandler({
				statusStateBlacklist: ["badfox"],
				enableStatusState: true,
			});
			const info = {
				mxid: "@_puppet_1_badfox:example.org",
				status: "Foxies!",
				presence: "online",
			} as any;
			const roomId = "!room:example.org";
			await handler["setMatrixStatusInRoom"](info, roomId);
			expect(CLIENT_STATE_EVENT_TYPE).to.equal("");
			expect(CLIENT_STATE_EVENT_KEY).to.equal("");
			expect(CLIENT_STATE_EVENT_DATA).eql({});
		});
	});
});
