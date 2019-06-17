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
			);
		`, "user_store");
		await store.createTable(`
			CREATE TABLE chan_store(
				mxid TEXT NOT NULL,
				room_id TEXT NOT NULL,
				puppet_id TEXT NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_url TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				topic TEXT DEFAULT NULL
			);
		`, "chan_store");
		await store.createTable(`
			CREATE TABLE puppet_store(
				puppet_id TEXT NOT NULL,
				data TEXT NOT NULL
			);
		`, "puppet_store");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS schema");
		await store.db.Exec("DROP TABLE IF EXISTS user_store");
		await store.db.Exec("DROP TABLE IF EXISTS chan_store");
		await store.db.Exec("DROP TABLE IF EXISTS puppet_store");
	}
}
