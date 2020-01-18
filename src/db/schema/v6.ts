/*
Copyright 2019 mx-puppet-bridge
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
	public description = "Add status room";
	public async run(store: Store) {
		await store.db.Exec("ALTER TABLE puppet_mxid_store ADD status_room TEXT DEFAULT NULL");
	}
	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.createTable(`
			CREATE TABLE puppet_mxid_store_tmp (
				puppet_mxid TEXT NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				token TEXT DEFAULT NULL
			);
		`, "puppet_mxid_store_tmp");
		await store.db.Exec(`INSERT INTO puppet_mxid_store_tmp
			(puppet_mxid, name, avatar_mxc, token)
			SELECT old.puppet_mxid, old.name, old.avatar_mxc, old.token
			FROM puppet_mxid_store AS old`);
		await store.db.Exec("DROP TABLE puppet_mxid_store");
		await store.db.Exec("ALTER TABLE puppet_mxid_store_tmp RENAME TO puppet_mxid_store");
	}
}
