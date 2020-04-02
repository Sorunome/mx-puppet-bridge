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
import { DbUserStore } from "../../src/db/userstore";
import { Store } from "../../src/store";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore(cache = true): Promise<DbUserStore> {
	const store = new Store({
		filename: ":memory:",
	} as any, {} as any);
	await store.init();
	return new DbUserStore(store.db, cache);
}

describe("DbUserStore", () => {
	for (const cache of [true, false]) {
		const extra = (cache ? " with cache" : " without cache");
		it("should handle normal data" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.get(1, "user")).to.be.null;
			const user = {
				puppetId: 1,
				userId: "user",
				name: "Fox Lover",
				avatarUrl: "https://fox",
				avatarMxc: "mxc://fox/avatar",
				avatarHash: "foxies",
			};
			await store.set(user);
			expect(await store.get(1, "user")).to.eql(user);
			user.name = "Fox Super Lover";
			await store.set(user);
			expect((await store.get(1, "user"))!.name).to.equal("Fox Super Lover");
			await store.delete(user);
			expect(await store.get(1, "user")).to.be.null;
		});
		it("should handle room overrides" + extra, async () => {
			const store = await getStore(cache);
			const user = {
				puppetId: 1,
				userId: "user",
				name: "Fox Lover",
				avatarUrl: "https://fox",
				avatarMxc: "mxc://fox/avatar",
				avatarHash: "foxies",
			};
			await store.set(user);
			expect(await store.getRoomOverride(1, "user", "!room")).to.be.null;
			const roomOverride = {
				puppetId: 1,
				userId: "user",
				roomId: "!room",
				name: "Bunny Lover",
				avatarUrl: "https://bunny",
				avatarMxc: "mxc://bunny/avatar",
				avatarHash: "bunnies",
			};
			await store.setRoomOverride(roomOverride);
			expect(await store.getRoomOverride(1, "user", "!room")).to.eql(roomOverride);
			roomOverride.name = "Bunny Super Lover";
			await store.setRoomOverride(roomOverride);
			expect((await store.getRoomOverride(1, "user", "!room"))!.name).to.equal("Bunny Super Lover");
			expect(await store.getAllRoomOverrides(1, "user")).to.eql([roomOverride]);
			await store.delete(user);
			expect(await store.getAllRoomOverrides(1, "user")).to.eql([]);
			expect(await store.getRoomOverride(1, "user", "!room")).to.be.null;
		});
	}
});
