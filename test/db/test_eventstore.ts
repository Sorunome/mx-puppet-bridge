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
import { DbEventStore } from "../../src/db/eventstore";
import { Store } from "../../src/store";
import * as prometheus from "prom-client";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

async function getStore(): Promise<DbEventStore> {
	prometheus.register.clear();
	const store = new Store({
		filename: ":memory:",
	} as any, {} as any);
	await store.init();
	return new DbEventStore(store.db);
}

beforeEach("Prometheus clean up", () => {
	prometheus.register.clear();
});

describe("DbEventStore", () => {
	it("should insert things", async () => {
		const store = await getStore();
		await store.insert(1, "room", "ma", "ra");
		await store.insert(1, "room", "mb", "rb");
		expect(await store.getRemote(1, "room", "ma")).to.eql(["ra"]);
		expect(await store.getMatrix(1, "room", "rb")).to.eql(["mb"]);
	});
	it("should fetch multi-results matrix->remote", async () => {
		const store = await getStore();
		await store.insert(1, "room", "ma", "ra");
		await store.insert(1, "room", "ma", "rb");
		expect(await store.getRemote(1, "room", "ma")).to.eql(["ra", "rb"]);
	});
	it("should fetch multi-results remote->matrix", async () => {
		const store = await getStore();
		await store.insert(1, "room", "ma", "ra");
		await store.insert(1, "room", "mb", "ra");
		expect(await store.getMatrix(1, "room", "ra")).to.eql(["ma", "mb"]);
	});
	it("should return blanks on not found", async () => {
		const store = await getStore();
		await store.insert(1, "room", "ma", "ra");
		expect(await store.getMatrix(1, "room", "rb")).to.eql([]);
		expect(await store.getRemote(1, "room", "mb")).to.eql([]);
	});
	it("should remove entires", async () => {
		const store = await getStore();
		await store.insert(1, "room", "ma", "ra");
		await store.remove(1, "room", "ra");
		expect(await store.getMatrix(1, "room", "ra")).to.eql([]);
	});
});
