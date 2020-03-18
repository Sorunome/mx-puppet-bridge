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
import { DbPuppetStore } from "../../src/db/puppetstore";
import { Store } from "../../src/store";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore(cache = true): Promise<DbPuppetStore> {
	const store = new Store({
		filename: ":memory:",
	} as any);
	await store.init();
	return new DbPuppetStore(store.db, cache);
}

describe("DbPuppetStore", () => {
	for (const cache of [true, false]) {
		const extra = (cache ? " with cache" : " without cache");
		it("should handle mxid info" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.getMxidInfo("@user")).to.be.null;
			expect((await store.getOrCreateMxidInfo("@user"))!.puppetMxid).to.equal("@user");
			expect((await store.getMxidInfo("@user"))!.puppetMxid).to.equal("@user");
			expect(await store.getMxidInfo("@user2")).to.be.null;
			const user = {
				puppetMxid: "@user2",
				name: "Heya!",
				avatarMxc: null,
				avatarUrl: null,
				token: null,
				statusRoom: null,
			};
			await store.setMxidInfo(user);
			expect(await store.getMxidInfo("@user2")).to.eql(user);
			user.name = "new name";
			await store.setMxidInfo(user);
			expect(await store.getMxidInfo("@user2")).to.eql(user);
		});
		it("should handle puppet info" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.get(1)).to.be.null;
			const puppetId = await store.new("@user", { fox: "yay" }, "remoteuser");
			expect(await store.get(puppetId)).to.eql({
				puppetId,
				puppetMxid: "@user",
				data: { fox: "yay" },
				userId: "remoteuser",
				type: "puppet",
				isPublic: false,
				autoinvite: true,
				isGlobalNamespace: false,
			});
			expect(await store.getMxid(puppetId)).to.equal("@user");
			await store.setUserId(puppetId, "newremoteuser");
			expect((await store.get(puppetId))!.userId).to.equal("newremoteuser");
			await store.setData(puppetId, { fox: "superyay" });
			expect((await store.get(puppetId))!.data).to.eql({ fox: "superyay" });
			await store.setType(puppetId, "relay");
			expect((await store.get(puppetId))!.type).to.equal("relay");
			await store.setIsPublic(puppetId, true);
			expect((await store.get(puppetId))!.isPublic).to.be.true;
			await store.setAutoinvite(puppetId, false);
			expect((await store.get(puppetId))!.autoinvite).to.be.false;
			await store.setIsGlobalNamespace(puppetId, true);
			expect((await store.get(puppetId))!.isGlobalNamespace).to.be.true;
			expect(await store.getForMxid("@invalid")).to.eql([]);
			expect(await store.getForMxid("@user")).to.eql([{
				puppetId,
				puppetMxid: "@user",
				data: { fox: "superyay" },
				userId: "newremoteuser",
				type: "relay",
				isPublic: true,
				autoinvite: false,
				isGlobalNamespace: true,
			}]);
			expect(await store.getAll()).to.eql([{
				puppetId,
				puppetMxid: "@user",
				data: { fox: "superyay" },
				userId: "newremoteuser",
				type: "relay",
				isPublic: true,
				autoinvite: false,
				isGlobalNamespace: true,
			}]);
			await store.delete(puppetId);
			expect(await store.get(puppetId)).to.be.null;
		});
		it("should handle ghosts" + extra, async () => {
			const store = await getStore(cache);
			expect(await store.isGhostInRoom("@ghost1", "@room1")).to.be.false;
			await store.joinGhostToRoom("@ghost1", "@room1");
			expect(await store.isGhostInRoom("@ghost1", "@room1")).to.be.true;
			await store.joinGhostToRoom("@ghost2", "@room1");
			await store.joinGhostToRoom("@ghost1", "@room2");
			expect(await store.getGhostsInRoom("@room1")).to.eql(["@ghost1", "@ghost2"]);
			expect(await store.getRoomsOfGhost("@ghost1")).to.eql(["@room1", "@room2"]);
			await store.emptyGhostsInRoom("@room1");
			expect(await store.getGhostsInRoom("@room1")).to.eql([]);
			expect(await store.isGhostInRoom("@ghost1", "@room2")).to.be.true;
			await store.leaveGhostFromRoom("@ghost1", "@room2");
			expect(await store.isGhostInRoom("@ghost1", "@room2")).to.be.false;
		});
	}
});
