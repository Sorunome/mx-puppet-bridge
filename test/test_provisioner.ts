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
import * as proxyquire from "proxyquire";

// we are a test file and thus our linting rules are slightly different
// tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers no-string-literal

const puppetEntries = [
	{
		puppetId: 1,
		puppetMxid: "@fox:example.org",
		data: { name: "Fox", token: "fox" },
		userId: "fox",
		type: "puppet",
		isPublic: false,
	},
	{
		puppetId: 2,
		puppetMxid: "@bunny:example.org",
		data: { name: "Bunny", token: "bunny" },
		userId: "bunny",
		type: "puppet",
		isPublic: false,
	},
];
const mxidInfoEntries = [
	{
		puppetMxid: "@fox:example.org",
		name: "Fox",
		avatarMxc: "mxc://example.org/fox",
		avatarUrl: null,
		token: null,
		statusRoom: "!foxstatus:example.org",
	},
	{
		puppetMxid: "@bunny:example.org",
		name: "Bunny",
		avatarMxc: "mxc://example.org/bunny",
		avatarUrl: null,
		token: "bunnytoken",
		statusRoom: "!foxstatus:example.org",
	},
];
let MATRIX_AUTH_DEVICENAME_SET = "";
let PUPPETSTORE_SET_MXID_INFO = {} as any;
let PUPPETSTORE_SET_USER_ID = "";
let PUPPETSTORE_SET_DATA = {} as any;
let PUPPETSTORE_NEW_MXID = "";
let PUPPETSTORE_DELETE = -1;
let BRIDGE_EVENTS_EMITTED: any[] = [];
let ROOMSYNC_DELETE_FOR_PUPPET = -1;
function getProvisioner() {
	MATRIX_AUTH_DEVICENAME_SET = "";
	PUPPETSTORE_SET_MXID_INFO = {};
	PUPPETSTORE_SET_USER_ID = "";
	PUPPETSTORE_SET_DATA = {};
	PUPPETSTORE_NEW_MXID = "";
	PUPPETSTORE_DELETE = -1;
	BRIDGE_EVENTS_EMITTED = [];
	ROOMSYNC_DELETE_FOR_PUPPET = -1;
	const bridge = {
		puppetStore: {
			getAll: async () => {
				return puppetEntries;
			},
			getForMxid: async (mxid) => {
				return puppetEntries.filter((e) => e.puppetMxid === mxid);
			},
			get: async (puppetId) => {
				return puppetEntries.find((e) => e.puppetId === puppetId) || null;
			},
			getMxid: async (puppetId) => {
				const entry = puppetEntries.find((e) => e.puppetId === puppetId);
				if (!entry) {
					throw new Error("not found");
				}
				return entry.puppetMxid;
			},
			getOrCreateMxidInfo: async (mxid) => {
				const existing = mxidInfoEntries.find((e) => e.puppetMxid === mxid);
				if (existing) {
					return existing;
				}
				return {
					puppetMxid: mxid,
					name: null,
					avatarMxc: null,
					avatarUrl: null,
					token: null,
					statusRoom: null,
				};
			},
			getMxidInfo: async (mxid) => {
				return mxidInfoEntries.find((e) => e.puppetMxid === mxid) || null;
			},
			setMxidInfo: async (info) => {
				PUPPETSTORE_SET_MXID_INFO = info;
			},
			setUserId: async (puppetId, userId) => {
				PUPPETSTORE_SET_USER_ID = `${puppetId};${userId}`;
			},
			setData: async (puppetId, data) => {
				PUPPETSTORE_SET_DATA = data;
			},
			new: async (mxid, data, userId) => {
				PUPPETSTORE_NEW_MXID = mxid;
				return 3;
			},
			delete: async (puppetId) => {
				PUPPETSTORE_DELETE = puppetId;
			},
		},
		roomStore: {
			getAll: async () => {
				return [];
			},
		},
		config: {
			bridge: {
				loginSharedSecretMap: {
					"example.org": "secret",
				},
			},
			homeserverUrlMap: {
				"override.org": "https://foxies.org",
			},
			provisioning: {
				whitelist: [ ".*:example\\.org" ],
				blacklist: [ "@bad:example\\.org" ],
			},
			relay: {
				whitelist: [ ".*" ],
				blacklist: [],
			},
		},
		protocol: {
			displayname: "Remote",
			features: {
				globalNamespace: true,
			},
		},
		emit: (type) => {
			BRIDGE_EVENTS_EMITTED.push(type);
		},
		hooks: {
			getDesc: async (puppetId, data) => {
				return `${data.name} (${data.token})`;
			},
		},
		roomSync: {
			deleteForPuppet: async (puppetId) => {
				ROOMSYNC_DELETE_FOR_PUPPET = puppetId;
			},
		},
	} as any;
	function MatrixAuth(homeserverUrl) { }
	MatrixAuth.prototype.passwordLogin = async (mxid, password, devicename) => {
		if (mxid.startsWith("@invalid")) {
			throw new Error("Invalid login");
		}
		MATRIX_AUTH_DEVICENAME_SET = devicename;
		return { accessToken: "token" };
	};
	const Provisioner = proxyquire.load("../src/provisioner", {
		"@sorunome/matrix-bot-sdk": { MatrixAuth },
		"./util": { Util: {
			DownloadFile: async (url) => {
				if (url.startsWith("https://example.org")) {
					return Buffer.from("{\"m.homeserver\": {\"base_url\": \"https://matrix.example.org\"}}");
				}
				return Buffer.from("");
			},
		}},
	}).Provisioner;
	return new Provisioner(bridge);
}

describe("Provisioner", () => {
	describe("getAll", () => {
		it("should fetch all puppets", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getAll();
			expect(ret).eql(puppetEntries);
		});
	});
	describe("getForMxid", () => {
		it("should fetch all puppets for an mxid", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getForMxid("@fox:example.org");
			expect(ret).eql([puppetEntries[0]]);
		});
		it("should return a blank array on an unknown mxid", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getForMxid("@unknown:example.org");
			expect(ret).eql([]);
		});
	});
	describe("get", () => {
		it("should fetch a puppet by puppetId", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.get(1);
			expect(ret).eql(puppetEntries[0]);
		});
		it("should return null for a non-found puppetId", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.get(42);
			expect(ret).to.be.null;
		});
	});
	describe("getMxid", () => {
		it("should fetch the mxid of a puppetId", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getMxid(1);
			expect(ret).to.equal("@fox:example.org");
		});
		it("should throw an error, if the puppetId is not found", async () => {
			const provisioner = getProvisioner();
			try {
				const ret = await provisioner.getMxid(42);
				throw new Error("should throw");
			} catch (err) {
				if (err.message === "should throw") {
					throw err;
				}
			}
		});
	});
	describe("loginWithSharedSecret", () => {
		it("should do nothing if homeserver not configured", async () => {
			const provisioner = getProvisioner();
			provisioner["getHsUrl"] = async (mxid) => "https://example.org";
			const ret = await provisioner.loginWithSharedSecret("@user:otherserver.com");
			expect(ret).to.be.null;
		});
		it("should log in just fine with a configured homeserver", async () => {
			const provisioner = getProvisioner();
			provisioner["getHsUrl"] = async (mxid) => "https://example.org";
			const ret = await provisioner.loginWithSharedSecret("@fox:example.org");
			expect(ret).to.equal("token");
			expect(MATRIX_AUTH_DEVICENAME_SET).to.equal("Remote Puppet Bridge");
		});
		it("should do nothing if login in the homeserver fails", async () => {
			const provisioner = getProvisioner();
			provisioner["getHsUrl"] = async (mxid) => "https://example.org";
			const ret = await provisioner.loginWithSharedSecret("@invalid:example.org");
			expect(ret).to.be.null;
		});
	});
	describe("getHsUrl", () => {
		it("should handle .well-known", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getHsUrl("@user:example.org");
			expect(ret).to.equal("https://matrix.example.org");
		});
		it("should handle manually configured overrides", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getHsUrl("@user:override.org");
			expect(ret).to.equal("https://foxies.org");
		});
		it("should just prepend https:// if all fails", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getHsUrl("@user:someserver.com");
			expect(ret).to.equal("https://someserver.com");
		});
		it("should prefix http:// for localhost", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getHsUrl("@user:localhost");
			expect(ret).to.equal("http://localhost");
		});
		it("should handle addresses with ports", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getHsUrl("@user:someserver.com:1234");
			expect(ret).to.equal("https://someserver.com:1234");
		});
	});
	describe("getToken", () => {
		it("should fetch a token by mxid", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getToken("@bunny:example.org");
			expect(ret).eql({
				hsUrl: "https://matrix.example.org",
				mxid: "@bunny:example.org",
				token: "bunnytoken",
			});
		});
		it("should fetch token by puppetId", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getToken(2);
			expect(ret).eql({
				hsUrl: "https://matrix.example.org",
				mxid: "@bunny:example.org",
				token: "bunnytoken",
			});
		});
		it("should return null, if no token found", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getToken(1);
			expect(ret).to.be.null;
		});
	});
	describe("setToken", () => {
		it("should set a token on an existing account", async () => {
			const provisioner = getProvisioner();
			await provisioner.setToken("@fox:example.org", "foxtoken");
			expect(PUPPETSTORE_SET_MXID_INFO.puppetMxid).to.equal("@fox:example.org");
			expect(PUPPETSTORE_SET_MXID_INFO.token).to.equal("foxtoken");
		});
		it("should set a token on a new account", async () => {
			const provisioner = getProvisioner();
			await provisioner.setToken("@new:example.org", "newtoken");
			expect(PUPPETSTORE_SET_MXID_INFO.puppetMxid).to.equal("@new:example.org");
			expect(PUPPETSTORE_SET_MXID_INFO.token).to.equal("newtoken");
		});
	});
	describe("setUserId", () => {
		it("should set the user ID", async () => {
			const provisioner = getProvisioner();
			await provisioner.setUserId(1, "userfox");
			expect(PUPPETSTORE_SET_USER_ID).to.equal("1;userfox");
		});
	});
	describe("setData", () => {
		it("should set data", async () => {
			const provisioner = getProvisioner();
			const data = { yay: "wohooo" };
			await provisioner.setData(1, data);
			expect(PUPPETSTORE_SET_DATA).eql(data);
		});
	});
	describe("canCreate", () => {
		it("should allow whitelisted users", () => {
			const provisioner = getProvisioner();
			const ret = provisioner.canCreate("@user:example.org");
			expect(ret).to.be.true;
		});
		it("should deny blacklisted users", () => {
			const provisioner = getProvisioner();
			const ret = provisioner.canCreate("@bad:example.org");
			expect(ret).to.be.false;
		});
		it("should deny users not in the whitelist", () => {
			const provisioner = getProvisioner();
			const ret = provisioner.canCreate("@user:otherserver.org");
			expect(ret).to.be.false;
		});
	});
	describe("canRelay", () => {
		it("should have its own black/whitelist", () => {
			const provisioner = getProvisioner();
			const ret = provisioner.canRelay("@user:otherserver.org");
			expect(ret).to.be.true;
		});
	});
	describe("new", () => {
		it("should deny, if you can't create", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.new("@user:otherserver.org", { yay: "foo" });
			expect(ret).to.equal(-1);
		});
		it("create a new puppet", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.new("@newuser:example.org", { yay: "foo" });
			expect(ret).to.equal(3);
			expect(BRIDGE_EVENTS_EMITTED).eql(["puppetNew"]);
			expect(PUPPETSTORE_NEW_MXID).to.equal("@newuser:example.org");
		});
	});
	describe("update", () => {
		it("should deny, if you can't create", async () => {
			const provisioner = getProvisioner();
			await provisioner.update("@user:otherserver.org", 1, { yay: "foo" });
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
		});
		it("should deny, if puppet id not found", async () => {
			const provisioner = getProvisioner();
			await provisioner.update("@fox:example.org", 3, { yay: "foo" });
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
		});
		it("should deny, if not your own puppet", async () => {
			const provisioner = getProvisioner();
			await provisioner.update("@user:example.org", 1, { yay: "foo" });
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
		});
		it("should update, is all fine", async () => {
			const provisioner = getProvisioner();
			await provisioner.update("@fox:example.org", 1, { yay: "foo" });
			expect(BRIDGE_EVENTS_EMITTED).eql(["puppetNew"]);
			expect(PUPPETSTORE_SET_DATA).eql({ yay: "foo" });
		});
	});
	describe("delete", () => {
		it("should do nothing, if puppet id is not found", async () => {
			const provisioner = getProvisioner();
			await provisioner.delete("@fox:example.org", 3);
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
		});
		it("should do nothing, if not your own puppet", async () => {
			const provisioner = getProvisioner();
			await provisioner.delete("@user:example.org", 1);
			expect(BRIDGE_EVENTS_EMITTED).eql([]);
		});
		it("should delete, is all fine", async () => {
			const provisioner = getProvisioner();
			await provisioner.delete("@fox:example.org", 1);
			expect(BRIDGE_EVENTS_EMITTED).eql(["puppetDelete"]);
			expect(ROOMSYNC_DELETE_FOR_PUPPET).to.equal(1);
			expect(PUPPETSTORE_DELETE).to.equal(1);
		});
	});
	describe("getDesc", () => {
		it("should return null if the puppet isn't found", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getDesc("@fox:example.org", 3);
			expect(ret).to.be.null;
		});
		it("should return null, if the puppet isn't ours", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getDesc("@other:example.org", 1);
			expect(ret).to.be.null;
		});
		it("should return the descriptor, is all fine", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getDesc("@fox:example.org", 1);
			expect(ret).eql({
				puppetId: 1,
				desc: "Fox (fox)",
				type: "puppet",
				isPublic: false,
			});
		});
	});
	describe("getDescMxid", () => {
		it("should return all the descriptors for the mxid", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getDescMxid("@fox:example.org");
			expect(ret).eql([{
				puppetId: 1,
				desc: "Fox (fox)",
				type: "puppet",
				isPublic: false,
			}]);
		});
	});
	describe("getDescFromData", () => {
		it("should return a descriptor based on data", async () => {
			const provisioner = getProvisioner();
			const ret = await provisioner.getDescFromData({
				puppetId: 42,
				data: {name: "Beep", token: "boop"},
				type: "puppet",
				isPublic: false,
			});
			expect(ret).eql({
				puppetId: 42,
				desc: "Beep (boop)",
				type: "puppet",
				isPublic: false,
			});
		});
	});
});
