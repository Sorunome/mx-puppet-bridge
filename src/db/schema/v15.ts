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
	public description = "add emote_store table";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE emote_store (
				puppet_id INTEGER NOT NULL,
				room_id TEXT,
				emote_id TEXT NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				data TEXT DEFAULT NULL
			);`, "emote_store");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE emote_store");
	}
}
