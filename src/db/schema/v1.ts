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
	public description = "Schema, Userstore, Roomstore";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE schema (
				version	INTEGER UNIQUE NOT NULL
			);`, "schema");
		await store.db.Exec("INSERT INTO schema VALUES (0);");
		await store.createTable(`
			CREATE TABLE user_store (
				user_id TEXT UNIQUE NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL
			);
		`, "user_store");
		await store.createTable(`
			CREATE TABLE chan_store(
				mxid TEXT NOT NULL,
				room_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				avatar_hash TEXT DEFAULT NULL,
				topic TEXT DEFAULT NULL
			);
		`, "chan_store");
		await store.createTable(`
			CREATE TABLE puppet_store(
				puppet_id SERIAL PRIMARY KEY,
				puppet_mxid TEXT NOT NULL,
				data TEXT NOT NULL,
				user_id TEXT DEFAULT NULL
			);
		`, "puppet_store");
		await store.createTable(`
			CREATE TABLE chan_op(
				chan_mxid TEXT NOT NULL,
				user_mxid TEXT NOT NULL
			);
		`, "chan_op");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS schema");
		await store.db.Exec("DROP TABLE IF EXISTS user_store");
		await store.db.Exec("DROP TABLE IF EXISTS chan_store");
		await store.db.Exec("DROP TABLE IF EXISTS puppet_store");
		await store.db.Exec("DROP TABLE IF EXISTS chan_op");
	}
}
