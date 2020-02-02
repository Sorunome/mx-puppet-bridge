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
import { MessageDeduplicator } from "../../src/structures/messagededuplicator";
import { Util } from "../../src/util";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

describe("MessageDeduplicator", () => {
	describe("Functionality", () => {
		it("should deduplicate messages based on content", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", undefined, "hello world");
			expect(ret).to.be.true;
			dedupe["authorIds"].delete("author");
		});
		it("should not dedupe message if content is different", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", undefined, "hello world!!");
			expect(ret).to.be.false;
			dedupe["authorIds"].delete("author");
			dedupe["data"].delete("room;author;m:hello world");
		});
		it("should not dedupe message if it is from a different author", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room");
			}, 50);
			const ret = await dedupe.dedupe("room", "author2", undefined, "hello world");
			expect(ret).to.be.false;
			dedupe["authorIds"].delete("author");
			dedupe["data"].delete("room;author;m:hello world");
		});
		it("should deduplicate messages based on event ID", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", "event");
			expect(ret).to.be.true;
			dedupe["authorIds"].delete("author");
		});
		it("should not dedupe message if event ID is different", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", "event2");
			expect(ret).to.be.false;
			dedupe["authorIds"].delete("author");
			dedupe["data"].delete("room;author;e:event");
		});
		it("should not dedupe message if event ID is from other author", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
			}, 50);
			setTimeout(() => {
				dedupe["authorIds"].delete("author");
				dedupe["data"].delete("room;author;e:event");
			}, 70);
			const ret = await dedupe.dedupe("room", "author2", "event");
			expect(ret).to.be.false;
		});
		it("should dedupe if event id matches, even if message doesn't", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", "event", "hello world!!");
			expect(ret).to.be.true;
			dedupe["authorIds"].delete("author");
			dedupe["data"].delete("room;author;m:hello world");
		});
		it("should dedupe if message matches, even if event id doesn't", async () => {
			const dedupe = new MessageDeduplicator();
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
			}, 50);
			const ret = await dedupe.dedupe("room", "author", "event2", "hello world");
			expect(ret).to.be.true;
			dedupe["authorIds"].delete("author");
			dedupe["data"].delete("room;author;e:event");
		});
		it("should dedupe if timeout is reached but message is correct", async () => {
			const dedupe = new MessageDeduplicator(50);
			dedupe.lock("room", "author", "hello world");
			setTimeout(() => {
				dedupe.unlock("room", "author", "event");
				dedupe["authorIds"].delete("author");
				dedupe["data"].delete("room;author;e:event");
			}, 75);
			const ret = await dedupe.dedupe("room", "author", "event", "hello world");
			expect(ret).to.be.true;
		})
	});
});
