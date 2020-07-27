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

import { IDbSchema } from "./dbschema";
import { Store } from "../../store";
import { Log } from "../../log";

async function createIndex(store: Store, table: string, columns: string[]) {
	const columnsStr = columns.join(", ");
	try {
		await store.db.Exec(`CREATE UNIQUE INDEX ${table}_unique ON ${table} (${columnsStr})`);
	} catch (err) {
		if (store.db.type === "postgres") {
			const wherestr = columns.map((c) => `a.${c} = b.${c}`).join(" AND ");
			await store.db.Exec(`DELETE FROM ${table} a WHERE a.ctid <> (SELECT min(b.ctid) FROM ${table} b WHERE ${wherestr})`);
		} else {
			await store.db.Exec(`DELETE FROM ${table} WHERE rowid NOT IN (SELECT min(rowid) FROM ${table} GROUP BY ${columnsStr})`);
		}
		await store.db.Exec(`CREATE UNIQUE INDEX ${table}_unique ON ${table} (${columnsStr})`);
	}
}

const indexes = [
	["room_store", ["puppet_id", "room_id"]],
	["group_store", ["puppet_id", "group_id"]],
	["group_store_rooms", ["puppet_id", "group_id", "room_id"]],
	["ghosts_joined_chans", ["ghost_mxid", "chan_mxid"]],
	["puppet_mxid_store", ["puppet_mxid"]],
	["emote_store", ["puppet_id", "room_id", "emote_id"]],
	["reaction_store", ["puppet_id", "room_id", "user_id", "event_id", "key"]],
	["user_store", ["puppet_id", "user_id"]],
	["user_store_room_override", ["puppet_id", "user_id", "room_id"]],
];

export class Schema implements IDbSchema {
	public description = "add unique indexes";
	public async run(store: Store) {
		for (const i of indexes) {
			await createIndex(store, i[0] as string, i[1] as string[]);
		}
	}
	public async rollBack(store: Store) {
		for (const i of indexes) {
			await store.db.Exec(`DROP INDEX IF EXISTS ${i[0]}_unique`);
		}
	}
}
