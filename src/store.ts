import { IDbSchema } from "./db/schema/dbschema";
import { SQLite3 } from "./db/sqlite3";
import { Postgres } from "./db/postgres";
import { Log } from "./log";
import { MxBridgeConfigDatabase } from "./config";
import { DbUserStore } from "./db/userstore";
import { DbChanStore } from "./db/chanstore";
import { IDatabaseConnector } from "./db/connector";
const log = new Log("Store");

export const CURRENT_SCHEMA = 1;

export class Store {
	public db: IDatabaseConnector;
	private pChanStore: DbChanStore;
	private pUserStore: DbUserStore;

	constructor(private config: MxBridgeConfigDatabase) { }

	get chanStore() {
		return this.pChanStore;
	}

	get userStore() {
		return this.pUserStore;
	}

	public async init(overrideSchema: number = 0): Promise<void> {
		log.info("Starting DB INit");
		await this.openDatabase();
		let version = await this.getSchemaVersion();
		const targetSchema = overrideSchema || CURRENT_SCHEMA;
		log.info(`Database schema version is ${version}, latest version is ${targetSchema}`);
		while (version < targetSchema) {
			version++;
			const schemaClass = require(`./db/schema/v${version}.js`).Schema;
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
			await this.setSchemaVersion(version);
		}
	}

	public async close() {
		this.db.Close();
	}

	public async createTable(statement: string, tablename: string) {
		try {
			await this.db.Exec(statement);
			log.info("Created table", tablename);
		} catch (err) {
			throw new Error(`Error creating '${tablename}': ${err}`);
		}
	}

	private async getSchemaVersion(): Promise<number> {
		log.silly("_get_schema_version");
		let version = 0;
		try {
			const versionReply = await this.db.Get(`SELECT version FROM schema`);
			version = versionReply!.version as number;
		} catch (er) {
			log.warn("Couldn't fetch schema version, defaulting to 0");
		}
		return version;
	}

	private async setSchemaVersion(ver: number): Promise<void> {
		log.silly("_set_schema_version => ", ver);
		await this.db.Run(
			`
			UPDATE schema
			SET version = $ver
			`, {ver},
		);
	}

	private async openDatabase(): Promise<void|Error> {
		if (this.config.filename) {
			log.info("Filename present in config, using sqlite");
			this.db = new SQLite3(this.config.filename);
		} else if (this.config.connString) {
			log.info("connString present in config, using postgres");
			this.db = new Postgres(this.config.connString);
		}
		try {
			this.db.Open();
			this.pChanStore = new DbChanStore(this.db);
			this.pUserStore = new DbUserStore(this.db);
		} catch (ex) {
			log.error("Error opening database:", ex);
			throw new Error("Couldn't open database. The appservice won't be able to continue.");
		}
	}
}
