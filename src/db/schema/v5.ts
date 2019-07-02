import { IDbSchema } from "./dbschema";
import { Store } from "../../store";

export class Schema implements IDbSchema {
	public description = "create event_store";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE event_store (
				puppet_id INTEGER NOT NULL,
				matrix_id TEXT DEFAULT NULL,
				remote_id TEXT DEFAULT NULL
			);
		`, "event_store");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS event_store");
	}
}
