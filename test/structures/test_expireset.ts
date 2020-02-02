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
import { ExpireSet } from "../../src/structures/expireset";
import { Util } from "../../src/util";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

describe("ExpireSet", () => {
	describe("Functionality", () => {
		it("should set and retreive simple values", async () => {
			const set = new ExpireSet<string>(50);
			set.add("test");
			expect(set.has("test")).to.be.true;
			expect(Array.from(set.all)).eql(["test"]);
			expect(set.size).to.equal(1);
			set.add("test");
			expect(set.has("test")).to.be.true;
			expect(Array.from(set.all)).eql(["test"]);
			expect(set.size).to.equal(1);
		});
		it("should expire a value", async () => {
			const set = new ExpireSet<string>(50);
			set.add("test");
			await Util.sleep(55);
			expect(set.has("test")).to.be.false;
		});
		it("should renew later on set values", async () => {
			const set = new ExpireSet<string>(50);
			set.add("test");
			await Util.sleep(30);
			expect(set.has("test")).to.be.true;
			set.add("test");
			await Util.sleep(25);
			expect(set.has("test")).to.be.true;
			await Util.sleep(30);
			expect(set.has("test")).to.be.false;
		});
	});
});
