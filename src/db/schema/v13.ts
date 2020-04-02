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

const log = new Log("v13 Migration");

export class Schema implements IDbSchema {
	public description = "chan_store --> room_store, and add more parameters";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE room_store (
				mxid TEXT NOT NULL,
				room_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				topic TEXT DEFAULT NULL,
				group_id TEXT DEFAULT NULL,
				is_direct INTEGER DEFAULT '0',
				e2be INTEGER DEFAULT '0',
				external_url TEXT DEFAULT NULL,
				is_used INTEGER DEFAULT '0'
			);
		`, "room_store");
		await store.db.Exec(`INSERT INTO room_store
			(mxid, room_id, puppet_id, name, avatar_url, avatar_mxc, avatar_hash, topic, group_id)
			SELECT old.mxid, old.room_id, old.puppet_id, old.name, old.avatar_url, old.avatar_mxc, old.avatar_hash, old.topic, old.group_id
			FROM chan_store AS old`);
		await store.db.Exec("DROP TABLE chan_store");
		const rows = await store.db.All("SELECT * FROM room_store");
		for (const row of rows) {
			const mxid = row.mxid as string;
			log.info(`Migrating room ${mxid}...`);
			try {
				const opMxid = await store.roomStore.getRoomOp(mxid);
				if (opMxid) {
					const opIntent = store.bridge.AS.getIntentForUserId(opMxid);
					try {
						const evt = await opIntent.underlyingClient.getRoomStateEvent(mxid, "m.room.canonical_alias", "");
						if (evt && evt.alias) {
							// assuming this is a non-direct room
							// so lets have the bridge bot join and OP it
							await store.bridge.botIntent.ensureRegisteredAndJoined(mxid);
							const powerLevels = await opIntent.underlyingClient.getRoomStateEvent(
								mxid, "m.room.power_levels", "",
							);
							powerLevels.users[store.bridge.botIntent.userId] = powerLevels.users[opMxid];
							await opIntent.underlyingClient.sendStateEvent(
								mxid, "m.room.power_levels", "", powerLevels,
							);
							await store.roomStore.setRoomOp(mxid, store.bridge.botIntent.userId);
						} else {
							await store.db.Run("UPDATE room_store SET is_direct = 1 WHERE mxid = $mxid", { mxid });
						}
					} catch (e) {
						log.verbose("No canonical alias found, assuming a direct chat");
						log.silly(e.error || e.body || e);
						await store.db.Run("UPDATE room_store SET is_direct = 1 WHERE mxid = $mxid", { mxid });
					}
				} else {
					log.warn(`No op in room ${mxid}, assuming a direct chat`);
					await store.db.Run("UPDATE room_store SET is_direct = 1 WHERE mxid = $mxid", { mxid });
				}
			} catch (err) {
				log.warn(`Failed to migrate room ${mxid}`, err);
			}
		}
	}

	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.createTable(`
			CREATE TABLE chan_store (
				mxid TEXT NOT NULL,
				room_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				topic TEXT DEFAULT NULL,
				group_id TEXT DEFAULT NULL
			);
		`, "chan_store");
		await store.db.Exec(`INSERT INTO chan_store
			(mxid, room_id, puppet_id, name, avatar_url, avatar_mxc, avatar_hash, topic, group_id)
			SELECT old.mxid, old.room_id, old.puppet_id, old.name, old.avatar_url, old.avatar_mxc, old.avatar_hash, old.topic, old.group_id
			FROM room_store AS old`);
		await store.db.Exec("DROP TABLE room_store");
	}
}
