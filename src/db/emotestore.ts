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

import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";
import { IEmoteStoreEntry } from "./interfaces";

const log = new Log("DbEmoteStore");

export class DbEmoteStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public newData(puppetId: number, roomId: string | null, emoteId: string): IEmoteStoreEntry {
		return {
			puppetId,
			roomId,
			emoteId,
			name: null,
			avatarUrl: null,
			avatarMxc: null,
			avatarHash: null,
			data: {},
		};
	}

	public async get(puppetId: number, roomId: string | null, emoteId: string): Promise<IEmoteStoreEntry | null> {
		if (roomId) {
			const row = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND room_id = $rid AND emote_id = $eid LIMIT 1", {
				pid: puppetId,
				rid: roomId,
				eid: emoteId,
			});
			return this.getFromRow(row);
		} else {
			const row = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND emote_id = $eid LIMIT 1", {
				pid: puppetId,
				eid: emoteId,
			});
			return this.getFromRow(row);
		}
	}

	public async getByMxc(puppetId: number, roomId: string | null, mxid: string): Promise<IEmoteStoreEntry | null> {
		if (roomId) {
			const row = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND room_id = $rid AND avatar_mxc = $mxid LIMIT 1", {
				pid: puppetId,
				rid: roomId,
				mxid,
			});
			return this.getFromRow(row);
		} else {
			const row = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND avatar_mxc = $mxid LIMIT 1", {
				pid: puppetId,
				mxid,
			});
			return this.getFromRow(row);
		}
	}

	public async getForRoom(puppetId: number, roomId: string): Promise<IEmoteStoreEntry[]> {
		const rows = await this.db.All("SELECT * FROM emote_store WHERE puppet_id = $pid AND room_id = $rid LIMIT 1", {
			pid: puppetId,
			rid: roomId,
		});
		const result: IEmoteStoreEntry[] = [];
		for (const r of rows) {
			const res = this.getFromRow(r);
			if (res) {
				result.push(res);
			}
		}
		return result;
	}

	public async set(data: IEmoteStoreEntry) {
		let exists: ISqlRow | null = null;
		if (data.roomId) {
			exists = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND room_id = $rid AND emote_id = $eid LIMIT 1", {
				pid: data.puppetId,
				rid: data.roomId,
				eid: data.emoteId,
			});
		} else {
			exists = await this.db.Get(
				"SELECT * FROM emote_store WHERE puppet_id = $pid AND emote_id = $eid LIMIT 1", {
				pid: data.puppetId,
				eid: data.emoteId,
			});
		}
		let query = "";
		if (!exists) {
			query = `INSERT INTO emote_store (
				puppet_id,
				room_id,
				emote_id,
				name,
				avatar_url,
				avatar_mxc,
				avatar_hash,
				data
			) VALUES (
				$pid,
				$rid,
				$eid,
				$name,
				$avatar_url,
				$avatar_mxc,
				$avatar_hash,
				$data
			)`;
		} else {
			query = `UPDATE emote_store SET
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				avatar_hash = $avatar_hash,
				data = $data
				WHERE puppet_id = $pid
				AND room_id = $rid
				AND emote_id = $eid`;
		}
		await this.db.Run(query, {
			pid: data.puppetId,
			rid: data.roomId || (exists && exists.room_id) || null,
			eid: data.emoteId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			avatar_hash: data.avatarHash || null,
			data: JSON.stringify(data.data || {}),
		});
	}

	private getFromRow(row: ISqlRow | null): IEmoteStoreEntry | null {
		if (!row) {
			return null;
		}
		return {
			puppetId: Number(row.puppet_id),
			roomId: (row.room_id || null) as string | null,
			emoteId: row.emote_id as string,
			name: (row.name || null) as string | null,
			avatarUrl: (row.avatar_url || null) as string | null,
			avatarMxc: (row.avatar_mxc || null) as string | null,
			avatarHash: (row.avatar_hash || null) as string | null,
			data: JSON.parse(row.data as string),
		};
	}
}
