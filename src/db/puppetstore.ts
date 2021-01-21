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
	isGlobalNamespace: boolean;
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
	private puppetCache: TimedCache<number, IPuppet>;
	private mxidInfoLock: Lock<string>;
	private allPuppetIds: Set<number> | null;
	private protocol: string;
	constructor(
		private db: IDatabaseConnector,
		cache: boolean = true,
		protocol: string = "unknown",
	) {
		this.mxidCache = new TimedCache(cache ? PUPPET_CACHE_LIFETIME : 0);
		this.puppetCache = new TimedCache(cache ? PUPPET_CACHE_LIFETIME : 0);
		this.mxidInfoLock = new Lock(MXID_INFO_LOCK_TIMEOUT);
		this.allPuppetIds = null;
		this.protocol = protocol;
	}

	public async deleteStatusRoom(mxid: string) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_status"));
		await this.db.Run("UPDATE puppet_mxid_store SET status_room = '' WHERE status_room = $mxid", { mxid });
		stopTimer();
	}

	public async getMxidInfo(puppetMxid: string): Promise<IMxidInfo | null> {
		const stopTimer = this.db.latency.startTimer(this.labels("get_mx_info"));
		const row = await this.db.Get("SELECT * FROM puppet_mxid_store WHERE puppet_mxid=$id", { id: puppetMxid });
		if (!row) {
			return null;
		}
		stopTimer();
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
		const stopTimer = this.db.latency.startTimer(this.labels("set_mxid_info"));
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
		stopTimer();
	}

	public async getAll(): Promise<IPuppet[]> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_all"));
		let result: IPuppet[] = [];
		if (this.allPuppetIds) {
			let haveAll = true;
			for (const puppetId of this.allPuppetIds) {
				const cached = this.puppetCache.get(puppetId);
				if (!cached) {
					haveAll = false;
					break;
				}
				result.push(cached);
			}
			if (haveAll) {
				return result;
			}
			result = [];
		}
		const rows = await this.db.All("SELECT * FROM puppet_store");
		this.allPuppetIds = new Set<number>();
		for (const r of rows) {
			const res = this.getRow(r);
			if (res) {
				this.allPuppetIds.add(res.puppetId);
				result.push(res);
			}
		}
		stopTimer();
		return result;
	}

	public async getForMxid(puppetMxid: string): Promise<IPuppet[]> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_for_mx"));
		const result: IPuppet[] = [];
		const rows = await this.db.All("SELECT * FROM puppet_store WHERE puppet_mxid=$mxid", { mxid: puppetMxid });
		for (const r of rows) {
			const res = this.getRow(r);
			if (res) {
				result.push(res);
			}
		}
		stopTimer();
		return result;
	}

	public async get(puppetId: number): Promise<IPuppet | null> {
		const stopTimer = this.db.latency.startTimer(this.labels("select"));
		const cached = this.puppetCache.get(puppetId);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get("SELECT * FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!row) {
			return null;
		}
		stopTimer();
		return this.getRow(row);
	}

	public async getMxid(puppetId: number): Promise<string> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_mxid"));
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
		stopTimer();
		return mxid;
	}

	public async setUserId(puppetId: number, userId: string) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_uid"));
		await this.db.Run("UPDATE puppet_store SET user_id=$uid WHERE puppet_id=$pid", {
			uid: userId,
			pid: puppetId,
		});
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async setData(puppetId: number, data: IPuppetData) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_data"));
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
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async setType(puppetId: number, type: PuppetType) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_type"));
		await this.db.Run("UPDATE puppet_store SET type=$t WHERE puppet_id=$id", {
			id: puppetId,
			t: PUPPET_TYPES.indexOf(type),
		});
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async setIsPublic(puppetId: number, isPublic: boolean) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_visibility"));
		await this.db.Run("UPDATE puppet_store SET is_public=$p WHERE puppet_id=$id", {
			id: puppetId,
			p: Number(isPublic), // booleans are stored as numbers
		});
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async setAutoinvite(puppetId: number, autoinvite: boolean) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_autoinvite"));
		await this.db.Run("UPDATE puppet_store SET autoinvite=$a WHERE puppet_id=$id", {
			id: puppetId,
			a: Number(autoinvite), // booleans are stored as numbers
		});
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async setIsGlobalNamespace(puppetId: number, isGlobalNamespace: boolean) {
		const stopTimer = this.db.latency.startTimer(this.labels("update_namespace"));
		await this.db.Run("UPDATE puppet_store SET is_global_namespace=$is WHERE puppet_id=$id", {
			id: puppetId,
			is: Number(isGlobalNamespace), // booleans are stored as numbers
		});
		this.puppetCache.delete(puppetId);
		stopTimer();
	}

	public async new(
		puppetMxid: string,
		data: IPuppetData,
		userId?: string,
		isGlobalNamespace: boolean = false,
	): Promise<number> {
		const stopTimer = this.db.latency.startTimer(this.labels("insert"));
		let dataStr = "";
		try {
			dataStr = JSON.stringify(data);
		} catch (err) {
			log.warn("Error strinifying json:", err);
			return -1;
		}
		const puppetId = await this.db.Run(
			`INSERT INTO puppet_store (puppet_mxid, data, user_id, type, is_public, autoinvite, is_global_namespace)
			VALUES ($mxid, $data, $uid, $type, $isPublic, $autoinvite, $isGlobalNamespace)`
		, {
			mxid: puppetMxid,
			data: dataStr,
			uid: userId || null,
			type: PUPPET_TYPES.indexOf("puppet"),
			isPublic: Number(false),
			autoinvite: Number(true),
			isGlobalNamespace: Number(isGlobalNamespace),
		}, "puppet_id");
		this.allPuppetIds = null;
		stopTimer();
		return puppetId;
	}

	public async delete(puppetId: number) {
		const stopTimer = this.db.latency.startTimer(this.labels("delete"));
		await this.db.Run("DELETE FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		this.mxidCache.delete(puppetId);
		this.puppetCache.delete(puppetId);
		this.allPuppetIds = null;
		stopTimer();
	}

	public async isGhostInRoom(ghostMxid: string, roomMxid: string): Promise<boolean> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_ghost_in_room"));
		const exists = await this.db.Get(
			"SELECT * FROM ghosts_joined_chans WHERE ghost_mxid = $ghostMxid AND chan_mxid = $roomMxid"
			, {
			ghostMxid,
			roomMxid,
		});
		stopTimer();
		return exists ? true : false;
	}

	public async joinGhostToRoom(ghostMxid: string, roomMxid: string) {
		const stopTimer = this.db.latency.startTimer(this.labels("insert_ghost_in_room"));
		if (await this.isGhostInRoom(ghostMxid, roomMxid)) {
			return;
		}
		await this.db.Run("INSERT INTO ghosts_joined_chans (ghost_mxid, chan_mxid) VALUES ($ghostMxid, $roomMxid)", {
			ghostMxid,
			roomMxid,
		});
		stopTimer();
	}

	public async getGhostsInRoom(room: string): Promise<string[]> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_all_ghost_in_room"));
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM ghosts_joined_chans WHERE chan_mxid = $room", { room });
		for (const r of rows) {
			result.push(r.ghost_mxid as string);
		}
		stopTimer();
		return result;
	}

	public async getRoomsOfGhost(ghost: string): Promise<string[]> {
		const stopTimer = this.db.latency.startTimer(this.labels("select_all_rooms_of_ghost"));
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM ghosts_joined_chans WHERE ghost_mxid = $ghost", { ghost });
		for (const r of rows) {
			result.push(r.chan_mxid as string);
		}
		stopTimer();
		return result;
	}

	public async emptyGhostsInRoom(room: string) {
		const stopTimer = this.db.latency.startTimer(this.labels("delete_ghosts_in_room"));
		await this.db.Run("DELETE FROM ghosts_joined_chans WHERE chan_mxid = $room", { room });
		stopTimer();
	}

	public async leaveGhostFromRoom(ghostMxid: string, roomMxid: string) {
		const stopTimer = this.db.latency.startTimer(this.labels("delete_ghost_in_room"));
		await this.db.Run("DELETE FROM ghosts_joined_chans " +
			"WHERE ghost_mxid = $g AND chan_mxid = $c", {
			g: ghostMxid,
			c: roomMxid,
		});
		stopTimer();
	}

	private getRow(row: ISqlRow): IPuppet | null {
		try {
			const ret: IPuppet = {
				puppetId: Number(row.puppet_id),
				puppetMxid: row.puppet_mxid as string,
				data: JSON.parse(row.data as string),
				userId: (row.user_id || null) as string | null,
				type: PUPPET_TYPES[row.type as number] || "invalid",
				isPublic: Boolean(Number(row.is_public)),
				autoinvite: Boolean(Number(row.autoinvite)),
				isGlobalNamespace: Boolean(Number(row.is_global_namespace)),
			};
			this.puppetCache.set(ret.puppetId, ret);
			return ret;
		} catch (err) {
			log.warn(`Unable to decode json data:${err} on puppet ${row.puppet_id}`);
			return null;
		}
	}

	private labels(queryName: string): object {
		return {
			protocol: this.protocol,
			engine: this.db.type,
			table: "puppet_store",
			type: queryName,
		};
	}
}
