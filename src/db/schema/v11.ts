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
	public description = "Add puppet types";
	public async run(store: Store) {
		await store.db.Exec("ALTER TABLE puppet_store ADD type INTEGER DEFAULT '0'");
		await store.db.Exec("ALTER TABLE puppet_store ADD is_public INTEGER DEFAULT '0'");
	}

	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.createTable(`
			CREATE TABLE puppet_store_tmp (
				puppet_id SERIAL PRIMARY KEY,
				puppet_mxid TEXT NOT NULL,
				data TEXT NOT NULL,
				user_id TEXT DEFAULT NULL
			);
		`, "puppet_store_tmp");
		await store.db.Exec(`INSERT INTO puppet_store_tmp
			(puppet_id, puppet_mxid, data, user_id)
			SELECT old.puppet_id, old.puppet_mxid, old.data, old.user_id
			FROM puppet_store AS old`);
		await store.db.Exec("DROP TABLE puppet_store");
		await store.db.Exec("ALTER TABLE puppet_store_tmp RENAME TO puppet_store");
	}
}
