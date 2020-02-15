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
import { TypingHandler } from "../src/typinghandler";
import { Util } from "../src/util";

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
	getIntent("");
	getClient("");
	const bridge = {
		AS: {
			isNamespacedUser: (userId) => userId.startsWith("@_puppet"),
			getIntentForUserId: (userId) => getIntent(userId),
		},
		botIntent: { userId: "@_puppet_bot:example.org" },
	} as any;
	const timeout = 50;
	return new TypingHandler(bridge, timeout);
}

describe("TypingHandler", () => {
	describe("set", () => {
		it("should ignore mxids not handled", async () => {
			const handler = getHandler();
			const mxid = "@user:example.org";
			const roomId = "!someroom:example.org";
			const typing = true;
			await handler.set(mxid, roomId, typing);
			expect(CLIENT_REQUEST_DATA).eql({});
		});
		it("should handle correct input", async () => {
			const handler = getHandler();
			const mxid = "@_puppet_1_fox:example.org";
			const roomId = "!someroom:example.org";
			const typing = true;
			await handler.set(mxid, roomId, typing);
			expect(CLIENT_REQUEST_METHOD).to.equal("PUT");
			expect(CLIENT_REQUEST_URL).to.equal("/_matrix/client/r0/rooms/!someroom%3Aexample.org" +
				"/typing/%40_puppet_1_fox%3Aexample.org");
			expect(CLIENT_REQUEST_DATA).eql({
				typing: true,
				timeout: 50,
			});
		});
		it("should do nothing if the user isn't typing anyways", async () => {
			const handler = getHandler();
			const mxid = "@_puppet_1_fox:example.org";
			const roomId = "!someroom:example.org";
			const typing = false;
			await handler.set(mxid, roomId, typing);
			expect(CLIENT_REQUEST_METHOD).to.equal("");
		});
		it("should do nothing, if the typing user timeouts", async () => {
			const handler = getHandler();
			const mxid = "@_puppet_1_fox:example.org";
			const roomId = "!someroom:example.org";
			await handler.set(mxid, roomId, true);
			expect(CLIENT_REQUEST_METHOD).to.equal("PUT");
			getClient("");
			await Util.sleep(55);
			await handler.set(mxid, roomId, false);
			expect(CLIENT_REQUEST_METHOD).to.equal("");
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
});
