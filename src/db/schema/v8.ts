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

export class Schema implements IDbSchema {
	public description = "Add group store";
	public async run(store: Store) {
		await store.db.Exec("ALTER TABLE chan_store ADD group_id TEXT DEFAULT NULL");
		await store.createTable(`
			CREATE TABLE group_store (
				mxid TEXT NOT NULL,
				group_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				short_description TEXT DEFAULT NULL,
				long_description TEXT DEFAULT NULL
			);
		`, "group_store");
		await store.createTable(`
			CREATE TABLE group_store_rooms (
				group_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				room_id TEXT NOT NULL
			);
		`, "group_store_rooms");
	}
	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.createTable(`
			CREATE TABLE chan_store_tmp (
				mxid TEXT NOT NULL,
				room_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				topic TEXT DEFAULT NULL
			);
		`, "chan_store_tmp");
		await store.db.Exec(`INSERT INTO chan_store_tmp
			(mxid, room_id, puppet_id, name, avatar_url, avatar_mxc, avatar_hash, topic)
			SELECT old.mxid, old.room_id, old.puppet_id, old.name, old.avatar_url, old.avatar_mxc, old.avatar_hash, old.topic
			FROM chan_store AS old`);
		await store.db.Exec("DROP TABLE chan_store");
		await store.db.Exec("ALTER TABLE chan_store_tmp RENAME TO chan_store");

		await store.db.Exec("DROP TABLE group_store");
		await store.db.Exec("DROP TABLE group_store_rooms");
	}
}
