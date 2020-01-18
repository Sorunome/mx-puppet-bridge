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
	public description = "add puppet_id to user_store";
	public async run(store: Store) {
		// sqlite doesn't have alter column and drop column, soooo this'll be a tad more complex
		await store.createTable(`
			CREATE TABLE user_store_tmp (
				user_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL
			);
		`, "user_store_tmp");
		await store.db.Exec(`INSERT INTO user_store_tmp
			(user_id, puppet_id, name, avatar_url, avatar_mxc, avatar_hash)
			SELECT old.user_id, '-1', old.name, old.avatar_url, old.avatar_mxc, old.avatar_hash
			FROM user_store AS old`);
		await store.db.Exec("DROP TABLE user_store");
		await store.db.Exec("ALTER TABLE user_store_tmp RENAME TO user_store");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS user_store_tmp");
	}
}
