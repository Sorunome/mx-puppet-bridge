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
	public description = "event_store add room_id";
	public async run(store: Store) {
		await store.db.Exec("ALTER TABLE event_store ADD room_id TEXT DEFAULT NULL");
	}
	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.createTable(`
			CREATE TABLE event_store_tmp (
				puppet_id INTEGER NOT NULL,
				matrix_id TEXT DEFAULT NULL,
				remote_id TEXT DEFAULT NULL
			);
		`, "puppet_store_tmp");
		await store.db.Exec(`INSERT INTO event_store_tmp
			(puppet_id, matrix_id, remote_id)
			SELECT old.puppet_id, old.matrix_id, old.remote_id
			FROM event_store AS old`);
		await store.db.Exec("DROP TABLE event_store");
		await store.db.Exec("ALTER TABLE event_store_tmp RENAME TO event_store");
	}
}
