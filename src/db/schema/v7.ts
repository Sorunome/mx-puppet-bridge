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
