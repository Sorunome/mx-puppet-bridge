import { IDbSchema } from "./db/schema/dbschema";
import { SQLite3 } from "./db/sqlite3";
import { Postgres } from "./db/postgres";
import { Log } from "./log";
import { DatabaseConfig } from "./config";
import { DbUserStore } from "./db/userstore";
import { DbRoomStore } from "./db/roomstore";
import { DbGroupStore } from "./db/groupstore";
import { DbPuppetStore } from "./db/puppetstore";
import { DbEventStore } from "./db/eventstore";
import { IDatabaseConnector } from "./db/connector";
import { Util } from "./util";
const log = new Log("Store");

export const CURRENT_SCHEMA = 9;

type GetSchemaClass = (version: number) => IDbSchema;

export class Store {
	public db: IDatabaseConnector;
	private pRoomStore: DbRoomStore;
	private pUserStore: DbUserStore;
	private pGroupStore: DbGroupStore;
	private pPuppetStore: DbPuppetStore;
	private pEventStore: DbEventStore;

	constructor(private config: DatabaseConfig) { }

	get roomStore() {
		return this.pRoomStore;
	}

	get userStore() {
		return this.pUserStore;
	}

	get groupStore() {
		return this.pGroupStore;
	}

	get puppetStore() {
		return this.pPuppetStore;
	}

	get eventStore() {
		return this.pEventStore;
	}

	public async init(
		overrideSchema: number = 0,
		table: string = "schema",
		getSchemaClass?: GetSchemaClass,
		openDatabase: boolean = true,
	): Promise<void> {
		log.info("Starting DB Init");
		if (openDatabase) {
			await this.openDatabase();
		}
		let version = await this.getSchemaVersion(table);
		const targetSchema = overrideSchema || CURRENT_SCHEMA;
		log.info(`Database schema version is ${version}, latest version is ${targetSchema}`);
		while (version < targetSchema) {
			version++;
			let schemaClass;
			if (getSchemaClass) {
				schemaClass = getSchemaClass(version);
			} else {
				schemaClass = require(`./db/schema/v${version}.js`).Schema;
			}
			const schema = new schemaClass();
			log.info(`Updating database to v${version}, "${schema.description}"`);
			try {
				await schema.run(this);
				log.info("Updated database to version ", version);
			} catch (ex) {
				log.error("Couldn't update database to schema ", version);
				log.error(ex);
				log.info("Rolling back to version ", version - 1);
				try {
					await schema.rollBack(this);
				} catch (ex) {
					log.error(ex);
					throw Error("Failure to update to latest schema. And failed to rollback.");
				}
				throw Error("Failure to update to latest schema.");
			}
			await this.setSchemaVersion(version, table);
		}
	}

	public async close() {
		await this.db.Close();
	}

	public async getFileMxc(thing: string | Buffer): Promise<string | null> {
		let key = "";
		if (typeof thing === "string") {
			key = thing;
		} else {
			key = Util.HashBuffer(thing);
		}
		const ret = await this.db.Get("SELECT mxc_url FROM file_mxc_map WHERE thing = $key", { key });
		if (!ret) {
			return null;
		}
		return ret.mxc_url as string;
	}

	public async setFileMxc(thing: string | Buffer, mxcUrl: string, filename?: string) {
		let key = "";
		if (typeof thing === "string") {
			key = thing;
		} else {
			key = Util.HashBuffer(thing);
		}
		if ((await this.getFileMxc(key))) {
			return; // nothing to do
		}
		if (!filename) {
			filename = "";
		}
		await this.db.Run("INSERT INTO file_mxc_map (thing, mxc_url, filename) VALUES ($key, $mxcUrl, $filename)",
			{ key, mxcUrl, filename });
	}

	public async createTable(statement: string, tablename: string) {
		try {
			if (this.db.type !== "postgres") {
				statement = statement.replace(/SERIAL PRIMARY KEY/g, "INTEGER  PRIMARY KEY AUTOINCREMENT");
			}
			await this.db.Exec(statement);
			log.info("Created table", tablename);
		} catch (err) {
			throw new Error(`Error creating '${tablename}': ${err}`);
		}
	}

	private async getSchemaVersion(table: string = "schema"): Promise<number> {
		log.silly(`_get_${table}_version`);
		let version = 0;
		try {
			// insecurely adding the table as it is in-code
			const versionReply = await this.db.Get(`SELECT version FROM ${table}`);
			version = versionReply!.version as number;
		} catch (er) {
			log.warn("Couldn't fetch schema version, defaulting to 0");
		}
		return version;
	}

	private async setSchemaVersion(ver: number, table: string = "schema"): Promise<void> {
		log.silly(`_set_${table}_version => `, ver);
		// insecurely adding the table as it is in-code
		await this.db.Run(
			`
			UPDATE ${table}
			SET version = $ver
			`, {ver},
		);
	}

	private async openDatabase(): Promise<void|Error> {
		if (this.config.connString) {
			log.info("connString present in config, using postgres");
			this.db = new Postgres(this.config.connString);
		} else if (this.config.filename) {
			log.info("Filename present in config, using sqlite");
			this.db = new SQLite3(this.config.filename);
		}
		try {
			this.db.Open();
			this.pRoomStore = new DbRoomStore(this.db);
			this.pUserStore = new DbUserStore(this.db);
			this.pGroupStore = new DbGroupStore(this.db);
			this.pPuppetStore = new DbPuppetStore(this.db);
			this.pEventStore = new DbEventStore(this.db);
		} catch (ex) {
			log.error("Error opening database:", ex);
			throw new Error("Couldn't open database. The appservice won't be able to continue.");
		}
	}
}
