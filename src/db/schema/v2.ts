import { IDbSchema } from "./dbschema";
import { Store } from "../../store";

export class Schema implements IDbSchema {
	public description = "puppetmxidstore";
	public async run(store: Store) {
		await store.createTable(`
			CREATE TABLE puppet_mxid_store (
				puppet_mxid TEXT NOT NULL,
				name TEXT DEFAULT NULL,
				avatar_mxc TEXT DEFAULT NULL,
				token TEXT DEFAULT NULL
			);
		`, "puppet_mxid_store");
	}
	public async rollBack(store: Store) {
		await store.db.Exec("DROP TABLE IF EXISTS puppet_mxid_store");
	}
}
