/*
Copyright 2019, 2020 mx-puppet-bridge
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

import { createHmac } from "crypto";
import { MatrixAuth } from "@sorunome/matrix-bot-sdk";
import { PuppetBridge } from "./puppetbridge";
import { DbPuppetStore, IPuppet, PuppetType } from "./db/puppetstore";
import { Log } from "./log";
import { Util } from "./util";
import { IPuppetData, RemoteRoomResolvable, RemoteGroupResolvable } from "./interfaces";

const log = new Log("Provisioner");

export interface IProvisionerDesc {
	puppetId: number;
	desc: string;
	type: PuppetType;
	isPublic: boolean;
}

export interface ITokenResponse {
	token: string;
	hsUrl: string;
}

export class Provisioner {
	private puppetStore: DbPuppetStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.puppetStore = this.bridge.puppetStore;
	}

	public async getAll(): Promise<IPuppet[]> {
		return await this.puppetStore.getAll();
	}

	public async getForMxid(puppetMxid: string): Promise<IPuppet[]> {
		return await this.puppetStore.getForMxid(puppetMxid);
	}

	public async get(puppetId: number): Promise<IPuppet | null> {
		return await this.puppetStore.get(puppetId);
	}

	public async getMxid(puppetId: number): Promise<string> {
		return await this.puppetStore.getMxid(puppetId);
	}

	public async loginWithSharedSecret(mxid: string): Promise<string | null> {
		const homeserver = mxid.substring(mxid.indexOf(":") + 1);
		const sharedSecret = this.bridge.config.bridge.loginSharedSecretMap[homeserver];
		if (!sharedSecret) {
			// Shared secret login not enabled for this homeserver.
			return null;
		}

		const hmac = createHmac("sha512", sharedSecret);
		const password = hmac.update(Buffer.from(mxid, "utf-8")).digest("hex");

		const homeserverUrl = await this.getHsUrl(mxid);
		const auth = new MatrixAuth(homeserverUrl);
		try {
			const client = await auth.passwordLogin(mxid, password, this.bridge.protocol.displayname + " Puppet Bridge");
			return client.accessToken;
		} catch (err) {
			// Shared secret is probably misconfigured, so make a warning log.
			log.warn("Failed to log into", mxid, "with shared secret:", err.error || err.body || err);
			return null;
		}
	}

	public async getHsUrl(mxid: string): Promise<string> {
		log.verbose(`Looking up Homserver URL for mxid ${mxid}...`);
		let hsUrl = mxid.substring(mxid.indexOf(":") + 1);
		if (this.bridge.config.homeserverUrlMap[hsUrl]) {
			hsUrl = this.bridge.config.homeserverUrlMap[hsUrl];
			log.verbose(`Override to ${hsUrl}`);
			return hsUrl;
		}
		if (hsUrl === "localhost") {
			hsUrl = "http://" + hsUrl;
		} else {
			hsUrl = "https://" + hsUrl;
		}
		try {
			const wellKnownStr = (await Util.DownloadFile(hsUrl + "/.well-known/matrix/client")).toString("utf-8");
			const wellKnown = JSON.parse(wellKnownStr);
			const maybeUrl = wellKnown["m.homeserver"].base_url;
			if (typeof maybeUrl === "string") {
				hsUrl = maybeUrl;
			}
		} catch (err) { } // do nothing
		log.verbose(`Resolved to ${hsUrl}`);
		return hsUrl;
	}

	public async getToken(puppetId: number | string): Promise<ITokenResponse | null> {
		let mxid = "";
		if (typeof puppetId === "string") {
			mxid = puppetId;
		} else {
			mxid = await this.getMxid(puppetId);
		}
		const info = await this.puppetStore.getMxidInfo(mxid);
		if (!info || !info.token) {
			return null;
		}
		const hsUrl = await this.getHsUrl(mxid);
		return {
			hsUrl,
			token: info.token,
		};
	}

	public async setToken(mxid: string, token: string | null) {
		const info = await this.puppetStore.getOrCreateMxidInfo(mxid);
		info.token = token;
		await this.puppetStore.setMxidInfo(info);
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.puppetStore.setUserId(puppetId, userId);
	}

	public async setData(puppetId: number, data: IPuppetData) {
		await this.puppetStore.setData(puppetId, data);
	}

	public async setType(puppetId: number, type: PuppetType) {
		await this.puppetStore.setType(puppetId, type);
	}

	public async setIsPublic(puppetId: number, isPublic: boolean) {
		await this.puppetStore.setIsPublic(puppetId, isPublic);
	}

	public async setAutoinvite(puppetId: number, autoinvite: boolean) {
		await this.puppetStore.setAutoinvite(puppetId, autoinvite);
	}

	public async setIsGlobalNamespace(puppetId: number, isGlobalNamespace: boolean) {
		if (!this.bridge.protocol.features.globalNamespace) {
			return;
		}
		const puppetData = await this.get(puppetId);
		if (!puppetData || puppetData.isGlobalNamespace === isGlobalNamespace) {
			return;
		}
		await this.puppetStore.setIsGlobalNamespace(puppetId, isGlobalNamespace);
		if (isGlobalNamespace) {
			// tslint:disable-next-line no-floating-promises
			this.bridge.roomSync.puppetToGlobalNamespace(puppetId);
		}
	}

	public canCreate(mxid: string): boolean {
		return this.isWhitelisted(mxid, this.bridge.config.provisioning.whitelist,
			this.bridge.config.provisioning.blacklist);
	}

	public canRelay(mxid: string): boolean {
		return this.isWhitelisted(mxid, this.bridge.config.relay.whitelist,
			this.bridge.config.relay.blacklist);
	}

	public canSelfService(mxid: string): boolean {
		return this.isWhitelisted(mxid, this.bridge.config.selfService.whitelist,
			this.bridge.config.selfService.blacklist);
	}

	public async new(puppetMxid: string, data: IPuppetData, userId?: string): Promise<number> {
		if (!this.canCreate(puppetMxid)) {
			return -1;
		}
		const isGlobal = Boolean(this.bridge.protocol.features.globalNamespace);
		const puppetId = await this.puppetStore.new(puppetMxid, data, userId, isGlobal);
		log.info(`Created new puppet with id ${puppetId}`);
		this.bridge.emit("puppetNew", puppetId, data);
		return puppetId;
	}

	public async update(puppetMxid: string, puppetId: number, data: IPuppetData, userId?: string) {
		if (!this.canCreate(puppetMxid)) {
			return;
		}
		const d = await this.get(puppetId);
		if (!d || d.puppetMxid !== puppetMxid) {
			return;
		}
		await this.setData(puppetId, data);
		if (userId) {
			await this.setUserId(puppetId, userId);
		}
		log.info(`Updating puppet with id ${puppetId}`);
		this.bridge.emit("puppetNew", puppetId, data);
	}

	public async delete(puppetMxid: string, puppetId: number) {
		log.info(`Deleting puppet with id ${puppetId}`);
		const data = await this.get(puppetId);
		if (!data || data.puppetMxid !== puppetMxid) {
			return;
		}
		await this.bridge.roomSync.deleteForPuppet(puppetId);
		await this.puppetStore.delete(puppetId);
		this.bridge.emit("puppetDelete", puppetId);
	}

	public async getDesc(puppetMxid: string, puppetId: number): Promise<IProvisionerDesc | null> {
		const data = await this.get(puppetId);
		if (!data || data.puppetMxid !== puppetMxid) {
			return null;
		}
		return await this.getDescFromData(data);
	}

	public async getDescMxid(puppetMxid: string): Promise<IProvisionerDesc[]> {
		const datas = await this.getForMxid(puppetMxid);
		const descs: IProvisionerDesc[] = [];
		for (const data of datas) {
			descs.push(await this.getDescFromData(data));
		}
		return descs;
	}

	public async bridgeRoom(userId: string, mxid: string, remoteIdent: string) {
		if (!this.bridge.hooks.createRoom || !this.bridge.hooks.roomExists) {
			throw new Error("Feature disabled");
		}
		if (!this.canSelfService(userId)) {
			throw new Error("Permission denied");
		}
		const roomParts = await this.bridge.roomSync.getPartsFromMxid(mxid);
		if (roomParts) {
			throw new Error("Room already bridged");
		}
		// check if they have PL to do stuffs
		const havePerm = await this.bridge.botIntent.underlyingClient.userHasPowerLevelFor(userId, mxid, "m.room.canonical_alias", true);
		if (!havePerm) {
			throw new Error("Insufficient permissions");
		}
		// now check if we have a relay present
		const allPuppets = await this.getAll();
		const allRelays = allPuppets.filter((p) => p.type === "relay" && p.isGlobalNamespace);
		if (allRelays.length < 1) {
			throw new Error("No relay puppets configured");
		}
		// now resolve the room id....
		let roomId = remoteIdent;
		if (this.bridge.hooks.resolveRoomId) {
			const res = await this.bridge.hooks.resolveRoomId(remoteIdent);
			if (!res) {
				throw new Error("Room not found");
			}
			roomId = res;
		}
		// time to check if the room ID exists at all
		let puppetId = -1;
		let fallbackPuppetId = -1;
		for (const puppet of allRelays) {
			const exists = await this.bridge.hooks.roomExists({
				puppetId: puppet.puppetId,
				roomId,
			});
			if (exists) {
				if (puppet.isPublic) {
					puppetId = puppet.puppetId;
					break;
				} else {
					fallbackPuppetId = puppet.puppetId;
				}
			}
		}
		if (puppetId === -1) {
			puppetId = fallbackPuppetId;
		}
		if (puppetId === -1) {
			throw new Error("No such remote room found");
		}
		const newRoomParts = await this.bridge.hooks.createRoom({
			puppetId,
			roomId,
		});
		if (!newRoomParts) {
			throw new Error("No such remote room found");
		}
		if (newRoomParts.isDirect) {
			throw new Error("Can't bridge direct rooms");
		}
		const oldRoom = await this.bridge.roomSync.maybeGet(newRoomParts);
		if (oldRoom && oldRoom.isUsed) {
			throw new Error("Room is already bridged");
		}
		// check if anyone has this room as status room, and if so, remove it
		await this.puppetStore.deleteStatusRoom(mxid);
		// alright, we did all the verifying, time to actually bridge this room!
		await this.bridge.roomSync.rebridge(mxid, newRoomParts);
	}

	public async unbridgeRoom(userId: string, ident: RemoteRoomResolvable): Promise<boolean> {
		const roomParts = await this.bridge.roomSync.resolve(ident, userId);
		if (!roomParts) {
			return false;
		}
		const room = await this.bridge.roomSync.maybeGet(roomParts);
		if (!room) {
			return false;
		}
		if (!(await this.bridge.namespaceHandler.isSoleAdmin(room, userId))) {
			return false;
		}
		// alright, unbridge the room
		await this.bridge.roomSync.delete(roomParts, true);
		return true;
	}

	/**
	 * Gives 100 power level to a user of a puppet-owned room
	 * @param {string} userId
	 * @param {RemoteRoomResolvable} room resolvable
	 * @returns {Promise<void>}
	 */
	public async setAdmin(userId: string, ident: RemoteRoomResolvable): Promise<void> {
		const ADMIN_POWER_LEVEL = 100;
		const roomParts = await this.bridge.roomSync.resolve(ident, userId);
		if (!roomParts) {
			throw new Error("Room not resolvable");
		}
		const room = await this.bridge.roomSync.maybeGet(roomParts);
		if (!room) {
			throw new Error("Room not found");
		}
		if (!(await this.bridge.namespaceHandler.isAdmin(room, userId))) {
			throw new Error("Not an admin");
		}
		const client = await this.bridge.roomSync.getRoomOp(room.mxid);
		if (!client) {
			throw new Error("Failed to get operator of " + room.mxid);
		}
		const members = await client.getJoinedRoomMembers(room.mxid);
		if (!members || !members.includes(userId)) {
			throw new Error(`The user (${userId}) isn't in room ${room.mxid}`);
		}
		await client.setUserPowerLevel(userId, room.mxid, ADMIN_POWER_LEVEL);
	}

	public async invite(userId: string, ident: RemoteRoomResolvable): Promise<boolean> {
		const roomParts = await this.bridge.roomSync.resolve(ident, userId);
		if (!roomParts) {
			return false;
		}
		const room = await this.bridge.roomSync.maybeGet(roomParts);
		if (!room) {
			return false;
		}
		if (await this.bridge.namespaceHandler.canSeeRoom(room, userId)) {
			const client = (await this.bridge.roomSync.getRoomOp(room.mxid)) || this.bridge.botIntent.underlyingClient;
			try {
				await client.inviteUser(userId, room.mxid);
				return true;
			} catch (err) {
				log.warn(`Failed to invite ${userId} to ${room.mxid}`, err.error || err.body || err);
				return false;
			}
		}
		return false;
	}

	public async groupInvite(userId: string, ident: RemoteGroupResolvable): Promise<boolean> {
		if (!this.bridge.groupSyncEnabled) {
			return false;
		}
		const groupParts = await this.bridge.groupSync.resolve(ident);
		if (!groupParts) {
			return false;
		}
		const group = await this.bridge.groupSync.maybeGet(groupParts);
		if (!group) {
			return false;
		}
		if (await this.bridge.namespaceHandler.canSeeGroup(group, userId)) {
			const client = this.bridge.botIntent.underlyingClient;
			const clientUnstable = client.unstableApis;
			try {
				await clientUnstable.inviteUserToGroup(group.mxid, userId);
				return true;
			} catch (err) {
				log.warn(`Failed to invite ${userId} to group ${group.mxid}`, err.error || err.body || err);
				return false;
			}
		}
		return false;
	}

	private async getDescFromData(data: IPuppet): Promise<IProvisionerDesc> {
		if (!this.bridge.hooks.getDesc) {
			return {
				puppetId: data.puppetId,
				desc: `${data.puppetMxid} (${data.puppetId})`,
				type: data.type,
				isPublic: data.isPublic,
			};
		}
		return {
			puppetId: data.puppetId,
			desc: await this.bridge.hooks.getDesc(data.puppetId, data.data),
			type: data.type,
			isPublic: data.isPublic,
		};
	}

	private isWhitelisted(mxid: string, whitelist: string[], blacklist: string[]): boolean {
		for (const b of blacklist) {
			if (mxid.match(b)) {
				return false;
			}
		}
		for (const w of whitelist) {
			if (mxid.match(w)) {
				return true;
			}
		}
		return false;
	}
}
