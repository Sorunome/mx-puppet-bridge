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
import { Util } from "../src/util";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

const FOXIES_HASH = "b3baab3d435960130d7428eeaa8e0cd73b34a8db48e67d551d8c8a3e0aaf06a4dbf0229db093c3" +
	"b410beeb5d098e5667abfeb6e8fbe62b5b3bbb87d7f9d45c2f";

describe("Util", () => {
	describe("str2mxid", () => {
		it("should keep lowercase as-is", () => {
			const ret = Util.str2mxid("foxies");
			expect(ret).to.equal("foxies");
		});
		it("should escape uppercase / underscore", () => {
			const ret = Util.str2mxid("Foxies_are_cool");
			expect(ret).to.equal("_foxies__are__cool");
		});
		it("should escape other characters", () => {
			const ret = Util.str2mxid("Füchschen");
			expect(ret).to.equal("_f=c3=bcchschen");
		});
		it("should escape single-digit hex codes", () => {
			const ret = Util.str2mxid("\x01foxies");
			expect(ret).to.equal("=01foxies");
		});
	});
	describe("mxid2str", () => {
		it("should keep lowercase as-is", () => {
			const ret = Util.mxid2str("foxies");
			expect(ret).to.equal("foxies");
		});
		it("should unescape things with underscores", () => {
			const ret = Util.mxid2str("_foxies__are__cool");
			expect(ret).to.equal("Foxies_are_cool");
		});
		it("should unescape other characters", () => {
			const ret = Util.mxid2str("_f=c3=bcchschen");
			expect(ret).to.equal("Füchschen");
		});
		it("should unescape single-digit hex codes", () => {
			const ret = Util.mxid2str("=01foxies");
			expect(ret).to.equal("\x01foxies");
		});
	});
	describe("HashBuffer", () => {
		it("should hash", () => {
			const ret = Util.HashBuffer(Buffer.from("foxies"));
			expect(ret).to.equal(FOXIES_HASH);
		});
	});
	describe("MaybeUploadFile", () => {
		it("should short-circuit to remove, if no buffer and no url is set", async () => {
			let fileUploaded = false;
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				return "mxc://newfile/example.org";
			};
			const data = {};
			const oldHash = FOXIES_HASH;
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			expect(fileUploaded).to.be.false;
			expect(ret).eql({
				doUpdate: true,
				mxcUrl: undefined,
				hash: "",
			});
		});
		it("should short-circuit to remove, if the buffer is zero bytes long", async () => {
			let fileUploaded = false;
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				return "mxc://newfile/example.org";
			};
			const data = {
				avatarBuffer: Buffer.from(""),
			};
			const oldHash = FOXIES_HASH;
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			expect(fileUploaded).to.be.false;
			expect(ret).eql({
				doUpdate: true,
				mxcUrl: undefined,
				hash: "",
			});
		});
		it("should not update, should the buffer hash be identitcal", async () => {
			let fileUploaded = false;
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				return "mxc://newfile/example.org";
			};
			const data = {
				avatarBuffer: Buffer.from("foxies"),
			};
			const oldHash = FOXIES_HASH;
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			expect(fileUploaded).to.be.false;
			expect(ret).eql({
				doUpdate: false,
				mxcUrl: undefined,
				hash: FOXIES_HASH,
			});
		});
		it("should upload, if all is fine", async () => {
			let fileUploaded = false;
			let fileUploadedName = "";
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				fileUploadedName = f;
				return "mxc://newfile/example.org";
			};
			const data = {
				avatarBuffer: Buffer.from("newfoxies"),
			};
			const oldHash = FOXIES_HASH;
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			expect(fileUploaded).to.be.true;
			expect(fileUploadedName).to.equal("remote_avatar");
			expect(ret).eql({
				doUpdate: true,
				mxcUrl: "mxc://newfile/example.org",
				hash: Util.HashBuffer(Buffer.from("newfoxies")),
			});
		});
		it("should auto-download, is a URl provided", async () => {
			let fileUploaded = false;
			let fileUploadedName = "";
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				fileUploadedName = f;
				return "mxc://newfile/example.org";
			};
			const data = {
				avatarUrl: "newfoxies",
			};
			const oldHash = FOXIES_HASH;
			const oldDownloadFile = Util.DownloadFile;
			Util.DownloadFile = async (f) => Buffer.from(f);
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			Util.DownloadFile = oldDownloadFile;
			expect(fileUploaded).to.be.true;
			expect(fileUploadedName).to.equal("remote_avatar");
			expect(ret).eql({
				doUpdate: true,
				mxcUrl: "mxc://newfile/example.org",
				hash: Util.HashBuffer(Buffer.from("newfoxies")),
			});
		});
		it("should set the filename from URL, if possible", async () => {
			let fileUploaded = false;
			let fileUploadedName = "";
			const uploadFn = async (b, m, f) => {
				fileUploaded = true;
				fileUploadedName = f;
				return "mxc://newfile/example.org";
			};
			const data = {
				avatarUrl: "http://example.org/fox.png?size=50",
			};
			const oldHash = FOXIES_HASH;
			const oldDownloadFile = Util.DownloadFile;
			Util.DownloadFile = async (f) => Buffer.from(f);
			const ret = await Util.MaybeUploadFile(uploadFn, data, oldHash);
			Util.DownloadFile = oldDownloadFile;
			expect(fileUploaded).to.be.true;
			expect(fileUploadedName).to.equal("fox.png");
			expect(ret).eql({
				doUpdate: true,
				mxcUrl: "mxc://newfile/example.org",
				hash: Util.HashBuffer(Buffer.from("http://example.org/fox.png?size=50")),
			});
		});
	});
	describe("ProcessProfileUpdate", () => {
		it("should handle new entries", async () => {
			const oldProfile = null;
			const newProfile = {
				name: "Fox",
				avatarUrl: "http://example.org/fox.png",
			};
			const namePattern = ":name";
			const uploadFn = (async () => {}) as any;
			const oldMaybeUploadFile = Util.MaybeUploadFile;
			Util.MaybeUploadFile = async (fn, data) => {
				return {
					doUpdate: true,
					mxcUrl: "mxc://newfile/example.org",
					hash: "blah",
				};
			};
			const res = await Util.ProcessProfileUpdate(oldProfile, newProfile, namePattern, uploadFn);
			Util.MaybeUploadFile = oldMaybeUploadFile;
			expect(res).eql({
				name: "Fox",
				avatarHash: "blah",
				avatarMxc: "mxc://newfile/example.org",
				avatarUrl: "http://example.org/fox.png",
			});
		});
		it("should handle updates", async () => {
			const oldProfile = {
				name: "Oldfox",
				avatarUrl: "http://example.org/oldfox.png",
			};
			const newProfile = {
				name: "Fox",
				avatarUrl: "http://example.org/fox.png",
			};
			const namePattern = ":name";
			const uploadFn = (async () => {}) as any;
			const oldMaybeUploadFile = Util.MaybeUploadFile;
			Util.MaybeUploadFile = async (fn, data) => {
				return {
					doUpdate: true,
					mxcUrl: "mxc://newfile/example.org",
					hash: "blah",
				};
			};
			const res = await Util.ProcessProfileUpdate(oldProfile, newProfile, namePattern, uploadFn);
			Util.MaybeUploadFile = oldMaybeUploadFile;
			expect(res).eql({
				name: "Fox",
				avatarHash: "blah",
				avatarMxc: "mxc://newfile/example.org",
				avatarUrl: "http://example.org/fox.png",
			});
		});
		it("shouldn't update the name, if it is identical", async () => {
			const oldProfile = {
				name: "Super Fox",
				avatarUrl: "http://example.org/oldfox.png",
			};
			const newProfile = {
				nameVars: {
					type: "Super",
					name: "Fox",
				},
				avatarUrl: "http://example.org/fox.png",
			};
			const namePattern = ":type :name";
			const uploadFn = (async () => {}) as any;
			const oldMaybeUploadFile = Util.MaybeUploadFile;
			Util.MaybeUploadFile = async (fn, data) => {
				return {
					doUpdate: true,
					mxcUrl: "mxc://newfile/example.org",
					hash: "blah",
				};
			};
			const res = await Util.ProcessProfileUpdate(oldProfile, newProfile, namePattern, uploadFn);
			Util.MaybeUploadFile = oldMaybeUploadFile;
			expect(res).eql({
				avatarHash: "blah",
				avatarMxc: "mxc://newfile/example.org",
				avatarUrl: "http://example.org/fox.png",
			});
		});
		it("shouldn't update the avatar, if it is identical", async () => {
			const oldProfile = {
				name: "Super Fox",
				avatarUrl: "http://example.org/fox.png",
			};
			const newProfile = {
				nameVars: {
					type: "Amazing",
					name: "Fox",
				},
				avatarUrl: "http://example.org/fox.png",
			};
			const namePattern = ":type :name";
			const uploadFn = (async () => {}) as any;
			const oldMaybeUploadFile = Util.MaybeUploadFile;
			Util.MaybeUploadFile = async (fn, data) => {
				return {
					doUpdate: true,
					mxcUrl: "mxc://newfile/example.org",
					hash: "blah",
				};
			};
			const res = await Util.ProcessProfileUpdate(oldProfile, newProfile, namePattern, uploadFn);
			Util.MaybeUploadFile = oldMaybeUploadFile;
			expect(res).eql({
				name: "Amazing Fox",
			});
		});
	});
});
