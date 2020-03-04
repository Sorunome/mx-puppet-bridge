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

const log = new Log("DbReactionStore");

export interface IReactionStoreEntry {
	puppetId: number;
	roomId: string;
	userId: string;
	eventId: string;
	reactionMxid: string;
	key: string;
}

export class DbReactionStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public async exists(data: IReactionStoreEntry): Promise<boolean> {
		const exists = await this.db.Get(
			`SELECT 1 FROM reaction_store WHERE puppet_id = $pid AND user_id = $uid
			AND room_id = $rid AND user_id = $uid AND event_id = $eid AND key = $key`, {
			pid: data.puppetId,
			rid: data.roomId,
			uid: data.userId,
			eid: data.eventId,
			key: data.key,
		});
		return exists ? true : false;
	}

	public async insert(data: IReactionStoreEntry): Promise<boolean> {
		if (await this.exists(data)) {
			return false;
		}
		await this.db.Run(`INSERT INTO reaction_store
			(puppet_id, user_id, room_id, event_id, reaction_mxid, key) VALUES
			($pid, $uid, $rid, $eid, $rmxid, $key)`, {
			pid: data.puppetId,
			uid: data.userId,
			rid: data.roomId,
			eid: data.eventId,
			rmxid: data.reactionMxid,
			key: data.key,
		});
		return true;
	}

	public async getFromReactionMxid(reactionMxid: string): Promise<IReactionStoreEntry | null> {
		const row = await this.db.Get(
			"SELECT * FROM reaction_store WHERE reaction_mxid = $reactionMxid", { reactionMxid },
		);
		return this.getFromRow(row);
	}

	public async getFromKey(data: IReactionStoreEntry): Promise<IReactionStoreEntry | null> {
		const row = await this.db.Get(
			`SELECT * FROM reaction_store WHERE puppet_id = $pid AND user_id = $uid AND room_id = $rid
			AND event_id = $eid AND key = $key`, {
			pid: data.puppetId,
			rid: data.roomId,
			uid: data.userId,
			eid: data.eventId,
			key: data.key,
		});
		return this.getFromRow(row);
	}

	public async getForEvent(puppetId: number, eventId: string): Promise<IReactionStoreEntry[]> {
		const rows = await this.db.All(
			"SELECT * FROM reaction_store WHERE puppet_id = $puppetId AND event_id = $eventId",
			{ puppetId, eventId },
		);
		const result: IReactionStoreEntry[] = [];
		for (const row of rows) {
			const entry = this.getFromRow(row);
			if (entry) {
				result.push(entry);
			}
		}
		return result;
	}

	public async delete(reactionMxid: string) {
		await this.db.Run("DELETE FROM reaction_store WHERE reaction_mxid = $reactionMxid", { reactionMxid });
	}

	public async deleteForEvent(puppetId: number, eventId: string) {
		await this.db.Run("DELETE FROM reaction_store WHERE puppet_id = $puppetId AND event_id = $eventId",
			{ puppetId, eventId },
		);
	}

	private getFromRow(row: ISqlRow | null): IReactionStoreEntry | null {
		if (!row) {
			return null;
		}
		return {
			puppetId: Number(row.puppet_id),
			roomId: row.room_id as string,
			userId: row.user_id as string,
			eventId: row.event_id as string,
			reactionMxid: row.reaction_mxid as string,
			key: row.key as string,
		};
	}
}
