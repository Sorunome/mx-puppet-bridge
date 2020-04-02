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
import { Store } from "../src/store";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore() {
	const store = new Store({
		filename: ":memory:",
	} as any, {} as any);
	await store.init();
	return store;
}

describe("Store", () => {
	describe("init", () => {
		it("should be able to create a db", async () => {
			await getStore();
		});
	});
	describe("get/set file mxc", async () => {
		it("should return null, if mxc isn't found", async () => {
			const store = await getStore();
			const ret = await store.getFileMxc("blah");
			expect(ret).to.be.null;
		});
		it("should return the mxc, if it is found", async () => {
			const store = await getStore();
			await store.setFileMxc("blah", "mxc://somefile");
			const ret = await store.getFileMxc("blah");
			expect(ret).to.equal("mxc://somefile");
		});
		it("should handle buffers", async () => {
			const store = await getStore();
			const buffer = Buffer.from("blubb");
			await store.setFileMxc(buffer, "mxc://somefile");
			const ret = await store.getFileMxc(buffer);
			expect(ret).to.equal("mxc://somefile");
		});
	});
});
