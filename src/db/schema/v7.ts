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
	public description = "Add file mxc map table";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE file_mxc_map (
				id SERIAL PRIMARY KEY,
				thing TEXT NOT NULL,
				mxc_url TEXT NOT NULL,
				filename TEXT
			);
		`, "file_mxc_map");
	}
	public async rollBack(store: Store) {
		// sqlite has no drop column
		await store.db.Exec("DROP TABLE file_mxc_map");
	}
}
