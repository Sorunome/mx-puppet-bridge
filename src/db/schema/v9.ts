import { IDbSchema } from "./dbschema";
import { Store } from "../../store";

export class Schema implements IDbSchema {
	public description = "User Store Room Override";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE user_store_room_override (
				user_id TEXT NOT NULL,
				puppet_id INTEGER NOT NULL,
				room_id TEXT NOT NULL,
				name TEXT,
				avatar_url TEXT,
				avatar_mxc TEXT,
				avatar_hash TEXT
			);`, "user_store_room_override");
	}

	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS user_store_room_override");
	}
}
