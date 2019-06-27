import { IDbSchema } from "./dbschema";
import { Store } from "../../store";

export class Schema implements IDbSchema {
	public description = "ghosts_joined_chans";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE ghosts_joined_chans (
				ghost_mxid TEXT NOT NULL,
				chan_mxid TEXT NOT NULL
			);
		`, "ghosts_joined_chans");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS ghosts_joined_chans");
	}
}
