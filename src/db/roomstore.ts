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
import { IRoomStoreEntry } from "./interfaces";

const log = new Log("DbRoomStore");

// tslint:disable-next-line:no-magic-numbers
const ROOM_CACHE_LIFETIME = 1000 * 60 * 60 * 24;

export class DbRoomStore {
	private remoteCache: TimedCache<string, IRoomStoreEntry>;
	private mxidCache: TimedCache<string, IRoomStoreEntry>;
	private opCache: TimedCache<string, string>;
	constructor(
		private db: IDatabaseConnector,
		cache: boolean = true,
	) {
		this.remoteCache = new TimedCache(cache ? ROOM_CACHE_LIFETIME : 0);
		this.mxidCache = new TimedCache(cache ? ROOM_CACHE_LIFETIME : 0);
		this.opCache = new TimedCache(cache ? ROOM_CACHE_LIFETIME : 0);
	}

	public newData(mxid: string, roomId: string, puppetId: number): IRoomStoreEntry {
		return {
			mxid,
			roomId,
			puppetId,
			isDirect: false,
			e2be: false,
			isUsed: false,
		};
	}

	public async getByRemote(puppetId: number, roomId: string): Promise<IRoomStoreEntry | null> {
		const cached = this.remoteCache.get(`${puppetId};${roomId}`);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM room_store WHERE room_id = $room_id AND puppet_id = $puppet_id", {
			room_id: roomId,
			puppet_id: puppetId,
		});
		return this.getFromRow(row);
	}

	public async getByPuppetId(puppetId: number): Promise<IRoomStoreEntry[]> {
		const rows = await this.db.All(
			"SELECT * FROM room_store WHERE puppet_id = $puppet_id", {
			puppet_id: puppetId,
		});
		const results: IRoomStoreEntry[] = [];
		for (const row of rows) {
			const res = this.getFromRow(row);
			if (res) {
				results.push(res);
			}
		}
		return results;
	}

	public async getByMxid(mxid: string): Promise<IRoomStoreEntry | null> {
		const cached = this.mxidCache.get(mxid);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM room_store WHERE mxid = $mxid", { mxid },
		);
		return this.getFromRow(row);
	}

	public async set(data: IRoomStoreEntry) {
		const exists = await this.db.Get(
			"SELECT * FROM room_store WHERE mxid = $mxid", {mxid: data.mxid},
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO room_store (
				mxid,
				room_id,
				puppet_id,
				name,
				avatar_url,
				avatar_mxc,
				avatar_hash,
				topic,
				group_id,
				is_direct,
				e2be,
				external_url,
				is_used
			) VALUES (
				$mxid,
				$room_id,
				$puppet_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$avatar_hash,
				$topic,
				$group_id,
				$is_direct,
				$e2be,
				$external_url,
				$is_used
			)`;
		} else {
			query = `UPDATE room_store SET
				room_id = $room_id,
				puppet_id = $puppet_id,
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				avatar_hash = $avatar_hash,
				topic = $topic,
				group_id = $group_id,
				is_direct = $is_direct,
				e2be = $e2be,
				external_url = $external_url,
				is_used = $is_used
				WHERE mxid = $mxid`;
		}
		await this.db.Run(query, {
			mxid: data.mxid,
			room_id: data.roomId,
			puppet_id: data.puppetId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			avatar_hash: data.avatarHash || null,
			topic: data.topic || null,
			group_id: data.groupId || null,
			is_direct: Number(data.isDirect),
			e2be: Number(data.e2be),
			external_url: data.externalUrl || null,
			is_used: Number(data.isUsed),
		});
		this.remoteCache.set(`${data.puppetId};${data.roomId}`, data);
		this.mxidCache.set(data.mxid, data);
	}

	public async delete(data: IRoomStoreEntry) {
		await this.db.Run(
			"DELETE FROM room_store WHERE mxid = $mxid", { mxid: data.mxid },
		);
		await this.db.Run(
			"DELETE FROM chan_op WHERE chan_mxid=$mxid", { mxid: data.mxid },
		);
		this.remoteCache.delete(`${data.puppetId};${data.roomId}`);
		this.mxidCache.delete(data.mxid);
		this.opCache.delete(data.mxid);
	}

	public async toGlobalNamespace(puppetId: number, roomId: string) {
		const exists = await this.getByRemote(-1, roomId);
		if (exists) {
			return;
		}
		const room = await this.getByRemote(puppetId, roomId);
		if (!room) {
			return;
		}
		await this.db.Run("UPDATE room_store SET puppet_id = -1, group_id = '' WHERE puppet_id = $pid AND room_id = $rid", {
			pid: puppetId,
			rid: roomId,
		});
		this.remoteCache.delete(`${puppetId};${roomId}`);
		this.mxidCache.delete(room.mxid);
		this.opCache.delete(room.mxid);
	}

	public async setRoomOp(roomMxid: string, userMxid: string) {
		const row = await this.db.Get("SELECT * FROM chan_op WHERE chan_mxid=$chan LIMIT 1", {
			chan: roomMxid,
		});
		if (row) {
			if ((row.user_mxid as string) === userMxid) {
				// nothing to do, we are already set
				return;
			}
			await this.db.Run("DELETE FROM chan_op WHERE chan_mxid=$chan", {
				chan: roomMxid,
			});
		}
		await this.db.Run("INSERT INTO chan_op (chan_mxid, user_mxid) VALUES ($chan, $user)", {
			chan: roomMxid,
			user: userMxid,
		});
		this.opCache.set(roomMxid, userMxid);
	}

	public async getRoomOp(roomMxid: string): Promise<string|null> {
		const cached = this.opCache.get(roomMxid);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get("SELECT user_mxid FROM chan_op WHERE chan_mxid=$chan LIMIT 1", {
			chan: roomMxid,
		});
		if (!row) {
			return null;
		}
		const userMxid = row.user_mxid as string;
		this.opCache.set(roomMxid, userMxid);
		return userMxid;
	}

	private getFromRow(row: ISqlRow | null): IRoomStoreEntry | null {
		if (!row) {
			return null;
		}
		const data = this.newData(
			row.mxid as string,
			row.room_id as string,
			Number(row.puppet_id),
		);
		data.name = row.name as string | null;
		data.avatarUrl = row.avatar_url as string | null;
		data.avatarMxc = row.avatar_mxc as string | null;
		data.avatarHash = row.avatar_hash as string | null;
		data.topic = row.topic as string | null;
		data.groupId = row.group_id as string | null;
		data.isDirect = Boolean(Number(row.is_direct));
		data.e2be = Boolean(Number(row.e2be));
		data.externalUrl = row.external_url as string | null;
		data.isUsed = Boolean(Number(row.is_used));

		this.remoteCache.set(`${data.puppetId};${data.roomId}`, data);
		this.mxidCache.set(data.mxid, data);
		return data;
	}
}
