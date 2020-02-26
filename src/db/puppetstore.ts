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

import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";
import { TimedCache } from "../structures/timedcache";
import { Lock } from "../structures/lock";
import { IPuppetData } from "../interfaces";

const log = new Log("DbPuppetStore");

// tslint:disable:no-magic-numbers
const PUPPET_CACHE_LIFETIME = 1000 * 60 * 60 * 24;
const MXID_INFO_LOCK_TIMEOUT = 1000;
// tslint:enable:no-magic-numbers

export type PuppetType = "puppet" | "relay" | "invalid";
export const PUPPET_TYPES: PuppetType[] = ["puppet", "relay"];

export interface IPuppet {
	puppetId: number;
	puppetMxid: string;
	data: IPuppetData;
	userId: string | null;
	type: PuppetType;
	isPublic: boolean;
	autoinvite: boolean;
}

export interface IMxidInfo {
	puppetMxid: string;
	name: string | null;
	avatarMxc: string | null;
	avatarUrl: string | null;
	token: string | null;
	statusRoom: string | null;
}

export class DbPuppetStore {
	private mxidCache: TimedCache<number, string>;
	private mxidInfoLock: Lock<string>;
	constructor(
		private db: IDatabaseConnector,
	) {
		this.mxidCache = new TimedCache(PUPPET_CACHE_LIFETIME);
		this.mxidInfoLock = new Lock(MXID_INFO_LOCK_TIMEOUT);
	}

	public async getMxidInfo(puppetMxid: string): Promise<IMxidInfo | null> {
		const row = await this.db.Get("SELECT * FROM puppet_mxid_store WHERE puppet_mxid=$id", { id: puppetMxid });
		if (!row) {
			return null;
		}
		return {
			puppetMxid,
			name: row.name as string | null,
			avatarMxc: row.avatar_mxc as string | null,
			avatarUrl: null,
			token: row.token as string | null,
			statusRoom: row.status_room as string | null,
		};
	}

	public async getOrCreateMxidInfo(puppetMxid: string): Promise<IMxidInfo> {
		await this.mxidInfoLock.wait(puppetMxid);
		this.mxidInfoLock.set(puppetMxid);
		const puppet = await this.getMxidInfo(puppetMxid);
		if (puppet) {
			this.mxidInfoLock.release(puppetMxid);
			return puppet;
		}
		const p: IMxidInfo = {
			puppetMxid,
			name: null,
			avatarMxc: null,
			avatarUrl: null,
			token: null,
			statusRoom: null,
		};
		await this.setMxidInfo(p);
		this.mxidInfoLock.release(puppetMxid);
		return p;
	}

	public async setMxidInfo(puppet: IMxidInfo) {
		const exists = await this.db.Get("SELECT * FROM puppet_mxid_store WHERE puppet_mxid=$id", { id: puppet.puppetMxid });
		let query = "";
		if (!exists) {
			query = `INSERT INTO puppet_mxid_store (
				puppet_mxid,
				name,
				avatar_mxc,
				token,
				status_room
			) VALUES (
				$puppetMxid,
				$name,
				$avatarMxc,
				$token,
				$statusRoom
			)`;
		} else {
			query = `UPDATE puppet_mxid_store SET
				name = $name,
				avatar_mxc = $avatarMxc,
				token = $token,
				status_room = $statusRoom
				WHERE puppet_mxid = $puppetMxid`;
		}
		await this.db.Run(query, {
			puppetMxid: puppet.puppetMxid,
			name: puppet.name || null,
			avatarMxc: puppet.avatarMxc || null,
			token: puppet.token || null,
			statusRoom: puppet.statusRoom || null,
		});
	}

	public async getAll(): Promise<IPuppet[]> {
		const result: IPuppet[] = [];
		const rows = await this.db.All("SELECT * FROM puppet_store");
		for (const r of rows) {
			const res = this.getRow(r);
			if (res) {
				result.push(res);
			}
		}
		return result;
	}

	public async getForMxid(puppetMxid: string): Promise<IPuppet[]> {
		const result: IPuppet[] = [];
		const rows = await this.db.All("SELECT * FROM puppet_store WHERE puppet_mxid=$mxid", { mxid: puppetMxid });
		for (const r of rows) {
			const res = this.getRow(r);
			if (res) {
				result.push(res);
			}
		}
		return result;
	}

	public async get(puppetId: number): Promise<IPuppet | null> {
		const row = await this.db.Get("SELECT * FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!row) {
			return null;
		}
		return this.getRow(row);
	}

	public async getMxid(puppetId: number): Promise<string> {
		const cached = this.mxidCache.get(puppetId);
		if (cached) {
			return cached;
		}
		const result = await this.db.Get("SELECT puppet_mxid FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!result) {
			throw new Error("Puppet not found");
		}
		const mxid = result.puppet_mxid as string;
		this.mxidCache.set(puppetId, mxid);
		return mxid;
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.db.Run("UPDATE puppet_store SET user_id=$uid WHERE puppet_id=$pid", {
			uid: userId,
			pid: puppetId,
		});
	}

	public async setData(puppetId: number, data: IPuppetData) {
		let dataStr = "";
		try {
			dataStr = JSON.stringify(data);
		} catch (err) {
			log.warn("Error stringifying json:", err);
			return;
		}
		await this.db.Run("UPDATE puppet_store SET data=$d WHERE puppet_id=$id", {
			d: dataStr,
			id: puppetId,
		});
	}

	public async setType(puppetId: number, type: PuppetType) {
		await this.db.Run("UPDATE puppet_store SET type=$t WHERE puppet_id=$id", {
			id: puppetId,
			t: PUPPET_TYPES.indexOf(type),
		});
	}

	public async setIsPublic(puppetId: number, isPublic: boolean) {
		await this.db.Run("UPDATE puppet_store SET is_public=$p WHERE puppet_id=$id", {
			id: puppetId,
			p: Number(isPublic), // booleans are stored as numbers
		});
	}

	public async setAutoinvite(puppetId: number, autoinvite: boolean) {
		await this.db.Run("UPDATE puppet_store SET autoinvite=$a WHERE puppet_id=$id", {
			id: puppetId,
			a: Number(autoinvite), // booleans are stored as numbers
		});
	}

	public async new(puppetMxid: string, data: IPuppetData, userId?: string): Promise<number> {
		let dataStr = "";
		try {
			dataStr = JSON.stringify(data);
		} catch (err) {
			log.warn("Error strinifying json:", err);
			return -1;
		}
		const puppetId = await this.db.Run(
			`INSERT INTO puppet_store (puppet_mxid, data, user_id, type, is_public)
			VALUES ($mxid, $data, $uid, $type, $isPublic)`
		, {
			mxid: puppetMxid,
			data: dataStr,
			uid: userId || null,
			type: PUPPET_TYPES.indexOf("puppet"),
			isPublic: false,
		}, "puppet_id");
		return puppetId;
	}

	public async delete(puppetId: number) {
		await this.db.Run("DELETE FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		this.mxidCache.delete(puppetId);
	}

	public async isGhostInRoom(ghostMxid: string, roomMxid: string): Promise<boolean> {
		const exists = await this.db.Get(
			"SELECT * FROM ghosts_joined_chans WHERE ghost_mxid = $ghostMxid AND chan_mxid = $roomMxid"
			, {
			ghostMxid,
			roomMxid,
		});
		return exists ? true : false;
	}

	public async joinGhostToRoom(ghostMxid: string, roomMxid: string) {
		if (await this.isGhostInRoom(ghostMxid, roomMxid)) {
			return;
		}
		await this.db.Run("INSERT INTO ghosts_joined_chans (ghost_mxid, chan_mxid) VALUES ($ghostMxid, $roomMxid)", {
			ghostMxid,
			roomMxid,
		});
	}

	public async getGhostsInRoom(room: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM ghosts_joined_chans WHERE chan_mxid = $room", { room });
		for (const r of rows) {
			result.push(r.ghost_mxid as string);
		}
		return result;
	}

	public async getRoomsOfGhost(ghost: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM ghosts_joined_chans WHERE ghost_mxid = $ghost", { ghost });
		for (const r of rows) {
			result.push(r.chan_mxid as string);
		}
		return result;
	}

	public async emptyGhostsInRoom(room: string) {
		await this.db.Run("DELETE FROM ghosts_joined_chans WHERE chan_mxid = $room", { room });
	}

	public async leaveGhostFromRoom(ghostMxid: string, roomMxid: string) {
		await this.db.Run("DELETE FROM ghosts_joined_chans " +
			"WHERE ghost_mxid = $g AND chan_mxid = $c", {
			g: ghostMxid,
			c: roomMxid,
		});
	}

	private getRow(row: ISqlRow): IPuppet | null {
		try {
			return {
				puppetId: Number(row.puppet_id),
				puppetMxid: row.puppet_mxid as string,
				data: JSON.parse(row.data as string),
				userId: row.user_id as string | null,
				type: PUPPET_TYPES[row.type as number] || "invalid",
				isPublic: Boolean(Number(row.is_public)),
				autoinvite: Boolean(Number(row.autoinvite)),
			};
		} catch (err) {
			log.warn(`Unable to decode json data:${err} on puppet ${row.puppet_id}`);
			return null;
		}
	}
}
