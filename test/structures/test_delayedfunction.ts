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
import { DelayedFunction } from "../../src/structures/delayedfunction";
import { Util } from "../../src/util";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

describe("DelayedFunction", () => {
	describe("set", () => {
		it("should set functions", async () => {
			const delayed = new DelayedFunction();
			let called = false;
			delayed.set("fox", () => {
				called = true;
			}, 50);
			expect(called).to.be.false;
			await Util.sleep(55);
			expect(called).to.be.true;
		});
		it("should clear the old timer, if specified", async () => {
			const delayed = new DelayedFunction();
			let called = false;
			delayed.set("fox", () => {
				called = true;
			}, 50, true);
			expect(called).to.be.false;
			await Util.sleep(30);
			expect(called).to.be.false;
			delayed.set("fox", () => {
				called = true;
			}, 50, true);
			await Util.sleep(25);
			expect(called).to.be.false;
			await Util.sleep(30);
			expect(called).to.be.true;
		});
		it("should not clear the old timer, if specified", async () => {
			const delayed = new DelayedFunction();
			let called = false;
			delayed.set("fox", () => {
				called = true;
			}, 50, false);
			expect(called).to.be.false;
			await Util.sleep(30);
			expect(called).to.be.false;
			delayed.set("fox", () => {
				called = false;
			}, 50, false);
			await Util.sleep(25);
			expect(called).to.be.true;
		});
	});
	describe("release", () => {
		it("should release functions", async () => {
			const delayed = new DelayedFunction();
			let called = false;
			delayed.set("fox", () => {
				called = true;
			}, 50);
			expect(called).to.be.false;
			delayed.release("fox");
			await Util.sleep(55);
			expect(called).to.be.false;
		});
	});
});
