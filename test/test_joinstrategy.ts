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
import { PuppetBridgeJoinRoomStrategy } from "../src/joinstrategy";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers

let CLIENT_INVITE_USER = "";
function getClient() {
	CLIENT_INVITE_USER = "";
	return {
		resolveRoom: async (roomId) => roomId,
		inviteUser: async (userId, roomId) => {
			CLIENT_INVITE_USER = `${userId};${roomId}`;
		},
	};
}

let UNDERLYING_STRATEGY_JOIN_ROOM = "";
function getStrategy(haveStrategy = false) {
	UNDERLYING_STRATEGY_JOIN_ROOM = "";
	const underlyingStrategy = {
		joinRoom: async (roomId, userId, apiCall) => {
			UNDERLYING_STRATEGY_JOIN_ROOM = `${roomId};${userId}`;
		},
	} as any;
	const bridge = {
		roomSync: {
			getRoomOp: async (roomId) => {
				return getClient();
			},
		},
	} as any;
	return new PuppetBridgeJoinRoomStrategy(haveStrategy ? underlyingStrategy : null, bridge);
}

describe("PuppetBridgeJoinRoomStrategy", () => {
	describe("joinRoom", () => {
		it("should just join the room, should it not fail", async () => {
			const strategy = getStrategy();
			const roomId = "!someroom:example.org";
			const userId = "@_puppet_1_fox:example.org";
			const apiCall = async (idOrAlias) => "Direct Join";
			const ret = await strategy.joinRoom(roomId, userId, apiCall);
			expect(ret).to.equal("Direct Join");
			expect(CLIENT_INVITE_USER).to.equal("");
		});
		it("should invite and then join the user, should the initial join fail", async () => {
			const strategy = getStrategy();
			const roomId = "!someroom:example.org";
			const userId = "@_puppet_1_fox:example.org";
			let apiCalls = 0;
			const apiCall = async (idOrAlias) => {
				apiCalls++;
				if (apiCalls === 1) {
					throw new Error("not allowed");
				} else {
					return "Indirect Join";
				}
			};
			const ret = await strategy.joinRoom(roomId, userId, apiCall);
			expect(ret).to.equal("Indirect Join");
			expect(CLIENT_INVITE_USER).to.equal("@_puppet_1_fox:example.org;!someroom:example.org");
		});
		it("should call an underlying strategy, if one is present", async () => {
			const strategy = getStrategy(true);
			const roomId = "!someroom:example.org";
			const userId = "@_puppet_1_fox:example.org";
			let apiCalls = 0;
			const apiCall = async (idOrAlias) => {
				apiCalls++;
				if (apiCalls === 1) {
					throw new Error("not allowed");
				} else {
					return "Indirect Join";
				}
			};
			const ret = await strategy.joinRoom(roomId, userId, apiCall);
			expect(ret).not.to.equal("Indirect Join");
			expect(CLIENT_INVITE_USER).to.equal("@_puppet_1_fox:example.org;!someroom:example.org");
			expect(UNDERLYING_STRATEGY_JOIN_ROOM).to.equal("!someroom:example.org;@_puppet_1_fox:example.org");
		});
	});
});
