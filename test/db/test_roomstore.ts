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
import { DbRoomStore } from "../../src/db/roomstore";
import { Store } from "../../src/store";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore(cache = true): Promise<DbRoomStore> {
	const store = new Store({
		filename: ":memory:",
	} as any, {} as any);
	await store.init();
	return new DbRoomStore(store.db, cache);
}

describe("DbRoomStore", () => {
	for (const cache of [true, false]) {
		const extra = (cache ? " with cache" : " without cache");
		it("should handle normal room storing" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.getByRemote(1, "room")).to.be.null;
			const room = {
				puppetId: 1,
				roomId: "room",
				mxid: "!room",
				name: "Room",
				avatarUrl: "http://avatar",
				avatarMxc: "mxc://blah/avatar",
				avatarHash: "foxies",
				topic: "Topic",
				groupId: "group",
				isDirect: false,
				e2be: false,
				externalUrl: "https://somebridge",
				isUsed: false,
			};
			await store.set(room);
			expect(await store.getByRemote(1, "room")).to.eql(room);
			room.name = "New Room";
			await store.set(room);
			expect((await store.getByRemote(1, "room"))!.name).to.equal("New Room");
			expect(await store.getByMxid("!room")).to.eql(room);
			expect(await store.getByPuppetId(1)).to.eql([room]);
			await store.delete(room);
			expect(await store.getByRemote(1, "room")).to.be.null;
			expect(await store.getByMxid("!room")).to.be.null;
			expect(await store.getByPuppetId(1)).to.eql([]);
		});
		it("should handle room OPs" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.getRoomOp("!room")).to.be.null;
			await store.setRoomOp("!room", "@user1");
			expect(await store.getRoomOp("!room")).to.equal("@user1");
			await store.setRoomOp("!room", "@user2");
			expect(await store.getRoomOp("!room")).to.equal("@user2");
			await store.setRoomOp("!room", "@user2");
			expect(await store.getRoomOp("!room")).to.equal("@user2");
		});
	}
});
