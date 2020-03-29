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
import { StringFormatter } from "../../src/structures/stringformatter";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

describe("StringFormatter", () => {
	describe("format", () => {
		it("should format simple things", () => {
			const pattern = ":foo :bar";
			const vars = {
				foo: "Foo",
				bar: "Bar",
			};
			const ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("Foo Bar");
		});
		it("should leave unknown variables blank", () => {
			const pattern = ":foo :bar";
			const vars = {
				foo: "Foo",
			};
			const ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("Foo ");
		});
		it("should do simple if-conditions", () => {
			const pattern = "[:cond?t,f]";
			const vars = {
				cond: "blah",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("t");
			vars.cond = "";
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("f");
		});
		it("should do nested if-conditions", () => {
			const pattern = "fox [:cond?and [:anim?Bunny,Raccoon],alone]";
			const vars = {
				cond: "",
				anim: "",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox alone");
			vars.cond = "blah";
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox and Raccoon");
			vars.anim = "blah";
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox and Bunny");
		});
		it("should handle backslash correctly", () => {
			let pattern = "fox [:cond?and \\[\\:anim\\?Bunny\\,Raccoon\\],alone]";
			const vars = {
				cond: "blah",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox and [:anim?Bunny,Raccoon]");
			pattern = "fox \\:cond \\[beep\\]";
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox :cond [beep]");
		});
		it("should do equality conditions", () => {
			const pattern = "[:var=fox?fox,bunny]";
			const vars = {
				var: "fox",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars.var = "nofox";
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
		});
		it("should do or conditions", () => {
			const pattern = "[:var1|:var2?fox,bunny]";
			let vars: any = {
				var1: "fox",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {
				var1: "fox",
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
		});
		it("should do and conditions", () => {
			const pattern = "[:var1&:var2?fox,bunny]";
			let vars: any = {
				var1: "fox",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
			vars = {
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
			vars = {
				var1: "fox",
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
		});
		it("should do xor conditions", () => {
			const pattern = "[:var1^:var2?fox,bunny]";
			let vars: any = {
				var1: "fox",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {
				var1: "fox",
				var2: "fox",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
			vars = {};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
		});
		it("should do paranthesis", () => {
			const pattern = "[(:var1=fox)&(:var2=bunny)?fox,bunny]";
			let vars: any = {
				var1: "fox",
			};
			let ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
			vars = {
				var2: "bunny",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
			vars = {
				var1: "fox",
				var2: "bunny",
			};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("fox");
			vars = {};
			ret = StringFormatter.format(pattern, vars);
			expect(ret).to.equal("bunny");
		});
	});
});
