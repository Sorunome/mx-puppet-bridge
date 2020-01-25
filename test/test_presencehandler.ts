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
function getClient(userId) {
	CLIENT_REQUEST_METHOD = "";
	CLIENT_REQUEST_URL = "";
	CLIENT_REQUEST_DATA = {};
	return {
		getUserId: async () => userId,
		doRequest: async (method, url, qs, data) => {
			CLIENT_REQUEST_METHOD = method;
			CLIENT_REQUEST_URL = url;
			CLIENT_REQUEST_DATA = data;
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

function getHandler() {
	const bridge = {
		AS: {
			isNamespacedUser: (userId) => userId.startsWith("@_puppet"),
			getIntentForUserId: (userId) => getIntent(userId),
		},
		botIntent: { userId: "@_puppet_bot:example.org" },
	} as any;
	return new PresenceHandler(bridge);
}

describe("PresenceHandler", () => {
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
			handler.setStatus("@user:example.org", "fox");
			expect(presenceSet).to.be.false;
		});
		it("should set status and push to the presence queue", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			handler.setStatus("@_puppet_1_fox:example.org", "fox");
			expect(presenceSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				status: "fox",
			});
		});
		it("should update an status, should it already exist", () => {
			const handler = getHandler();
			let presenceSet = false;
			handler["setMatrixPresence"] = ((info) => {
				presenceSet = true;
			}) as any;
			handler.setStatus("@_puppet_1_fox:example.org", "fox");
			handler.setStatus("@_puppet_1_fox:example.org", "raccoon");
			expect(presenceSet).to.be.true;
			expect(handler["presenceQueue"].length).to.equal(1);
			expect(handler["presenceQueue"][0]).eql({
				mxid: "@_puppet_1_fox:example.org",
				status: "raccoon",
			});
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
			});
			expect(setPresence).to.be.true;
		});
		it("should pop offline users from the queue", async () => {
			const handler = getHandler();
			handler["presenceQueue"].push({
				mxid: "@_puppet_1_fox:example.org",
				presence: "offline",
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
});
