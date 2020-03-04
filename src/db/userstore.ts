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
import { IUserStoreEntry, IUserStoreRoomOverrideEntry } from "./interfaces";

const log = new Log("DbUserStore");

// tslint:disable-next-line:no-magic-numbers
const USERS_CACHE_LIFETIME = 1000 * 60 * 60 * 24;

export class DbUserStore {
	private usersCache: TimedCache<string, IUserStoreEntry>;
	constructor(
		private db: IDatabaseConnector,
		cache: boolean = true,
	) {
		this.usersCache = new TimedCache(cache ? USERS_CACHE_LIFETIME : 0);
	}

	public newData(puppetId: number, userId: string): IUserStoreEntry {
		return {
			puppetId,
			userId,
		};
	}

	public async get(puppetId: number, userId: string): Promise<IUserStoreEntry | null> {
		const cacheKey = `${puppetId};${userId}`;
		const cached = this.usersCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM user_store WHERE user_id = $id AND puppet_id = $pid", {id: userId, pid: puppetId},
		);
		if (!row) {
			return null;
		}
		const data = this.newData(puppetId, userId);
		data.name = row.name as string | null;
		data.avatarUrl = row.avatar_url as string | null;
		data.avatarMxc = row.avatar_mxc as string | null;
		data.avatarHash = row.avatar_hash as string | null;
		this.usersCache.set(cacheKey, data);
		return data;
	}

	public async set(data: IUserStoreEntry) {
		const exists = await this.db.Get(
			"SELECT 1 FROM user_store WHERE user_id = $id AND puppet_id = $pid", {id: data.userId, pid: data.puppetId},
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO user_store (
				user_id,
				puppet_id,
				name,
				avatar_url,
				avatar_mxc,
				avatar_hash
			) VALUES (
				$user_id,
				$puppet_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$avatar_hash
			)`;
		} else {
			query = `UPDATE user_store SET
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				avatar_hash = $avatar_hash
				WHERE user_id = $user_id AND puppet_id = $puppet_id`;
		}
		await this.db.Run(query, {
			user_id: data.userId,
			puppet_id: data.puppetId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			avatar_hash: data.avatarHash || null,
		});
		const cacheKey = `${data.puppetId};${data.userId}`;
		this.usersCache.set(cacheKey, data);
	}

	public async delete(data: IUserStoreEntry) {
		await this.db.Run("DELETE FROM user_store WHERE user_id = $user_id AND puppet_id = $puppet_id", {
			user_id: data.userId,
			puppet_id: data.puppetId,
		});
		// also delete the room overrides
		await this.db.Run("DELETE FROM user_store_room_override WHERE user_id = $user_id AND puppet_id = $puppet_id", {
			user_id: data.userId,
			puppet_id: data.puppetId,
		});
		const cacheKey = `${data.puppetId};${data.userId}`;
		this.usersCache.delete(cacheKey);
	}

	public newRoomOverrideData(puppetId: number, userId: string, roomId: string): IUserStoreRoomOverrideEntry {
		return {
			puppetId,
			userId,
			roomId,
		};
	}

	public async getRoomOverride(
		puppetId: number,
		userId: string,
		roomId: string,
	): Promise<IUserStoreRoomOverrideEntry | null> {
		const row = await this.db.Get(
			"SELECT * FROM user_store_room_override WHERE user_id = $uid AND puppet_id = $pid AND room_id = $rid", {
			uid: userId,
			pid: puppetId,
			rid: roomId,
		});
		if (!row) {
			return null;
		}
		return this.getRoomOverrideFromRow(row);
	}

	public async setRoomOverride(data: IUserStoreRoomOverrideEntry) {
		const exists = await this.db.Get(
			"SELECT 1 FROM user_store_room_override WHERE user_id = $uid AND puppet_id = $pid AND room_id = $rid", {
			uid: data.userId,
			pid: data.puppetId,
			rid: data.roomId,
		});
		let query = "";
		if (!exists) {
			query = `INSERT INTO user_store_room_override (
				user_id,
				puppet_id,
				room_id,
				name,
				avatar_url,
				avatar_mxc,
				avatar_hash
			) VALUES (
				$user_id,
				$puppet_id,
				$room_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$avatar_hash
			)`;
		} else {
			query = `UPDATE user_store_room_override SET
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				avatar_hash = $avatar_hash
				WHERE user_id = $user_id AND puppet_id = $puppet_id AND room_id = $room_id`;
		}
		await this.db.Run(query, {
			user_id: data.userId,
			puppet_id: data.puppetId,
			room_id: data.roomId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			avatar_hash: data.avatarHash || null,
		});
	}

	public async getAllRoomOverrides(puppetId: number, userId: string): Promise<IUserStoreRoomOverrideEntry[]> {
		const result: IUserStoreRoomOverrideEntry[] = [];
		const rows = await this.db.All(
			"SELECT * FROM user_store_room_override WHERE user_id = $uid AND puppet_id = $pid", {
			uid: userId,
			pid: puppetId,
		});
		for (const row of rows) {
			const entry = this.getRoomOverrideFromRow(row);
			if (entry) {
				result.push(entry);
			}
		}
		return result;
	}

	private getRoomOverrideFromRow(row: ISqlRow | null): IUserStoreRoomOverrideEntry | null {
		if (!row) {
			return null;
		}
		const data = this.newRoomOverrideData(
			Number(row.puppet_id),
			row.user_id as string,
			row.room_id as string,
		);
		data.name = row.name as string | null;
		data.avatarUrl = row.avatar_url as string | null;
		data.avatarMxc = row.avatar_mxc as string | null;
		data.avatarHash = row.avatar_hash as string | null;
		return data;
	}
}
