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
import { DbGroupStore } from "../../src/db/groupstore";
import { Store } from "../../src/store";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore(cache = true): Promise<DbGroupStore> {
	const store = new Store({
		filename: ":memory:",
	} as any);
	await store.init();
	return new DbGroupStore(store.db, cache);
}

describe("DbGroupStore", () => {
	for (const cache of [true, false]) {
		const extra = (cache ? " with cache" : " without cache");
		it("should set, get and delete" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.getByRemote(1, "r1")).to.be.null;
			const group = {
				mxid: "+group",
				groupId: "r1",
				puppetId: 1,
				name: "group",
				avatarUrl: "http://someurl",
				avatarMxc: "mxc://someserver/someurl",
				avatarHash: "foxies",
				shortDescription: "short desc",
				longDescription: "long desc",
				roomIds: ["!room1", "!room2"],
			};
			await store.set(group);
			expect(await store.getByRemote(1, "r1")).to.eql(group);
			await store.delete(group);
			expect(await store.getByRemote(1, "r1")).to.be.null;
		});
		it("should reflect room changes" + extra, async () => {
			const store = await getStore(cache);
			let roomIds = ["!room1", "!room2"];
			const group = {
				mxid: "+group",
				groupId: "r1",
				puppetId: 1,
				roomIds,
			};
			await store.set(group);
			expect((await store.getByRemote(1, "r1"))!.roomIds).to.eql(["!room1", "!room2"]);
			roomIds.push("!room3");
			group.roomIds = roomIds;
			await store.set(group);
			expect((await store.getByRemote(1, "r1"))!.roomIds).to.eql(["!room1", "!room2", "!room3"]);
			roomIds.push("!room4");
			roomIds.push("!room4");
			group.roomIds = roomIds;
			await store.set(group);
			expect((await store.getByRemote(1, "r1"))!.roomIds).to.eql(["!room1", "!room2", "!room3", "!room4"]);
			roomIds = ["!room2"];
			group.roomIds = roomIds;
			await store.set(group);
			expect((await store.getByRemote(1, "r1"))!.roomIds).to.eql(["!room2"]);
		});
		it("should get by mxid" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.getByMxid("+group")).to.be.null;
			const group = {
				mxid: "+group",
				groupId: "r1",
				puppetId: 1,
				name: "group",
				avatarUrl: "http://someurl",
				avatarMxc: "mxc://someserver/someurl",
				avatarHash: "foxies",
				shortDescription: "short desc",
				longDescription: "long desc",
				roomIds: ["!room1", "!room2"],
			};
			await store.set(group);
			expect(await store.getByMxid("+group")).to.eql(group);
		});
	}
});
