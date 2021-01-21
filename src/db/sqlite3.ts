/*
Copyright 2018 matrix-appservice-discord

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

import * as Database from "better-sqlite3";
import { Log } from "../log";
import { IDatabaseConnector, ISqlCommandParameters, ISqlRow } from "./connector";
import * as prometheus from "prom-client";
const log = new Log("SQLite3");

export class SQLite3 implements IDatabaseConnector {
	public type = "sqlite";
	public latency: prometheus.Histogram<string>;
	private db: Database;
	private insertId: number;
	constructor(private filename: string) {
		this.insertId = -1;
		this.latency = new prometheus.Histogram({
			name: "bridge_database_query_seconds",
			help: "Time spent querying the database engine",
			labelNames: ["protocol", "engine", "type", "table"],
			// tslint:disable-next-line no-magic-numbers
			buckets: [0.002, 0.005, 0.0075, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
		});
	}

	public async Open() {
		log.info(`Opening ${this.filename}`);
		this.db = new Database(this.filename);
	}

	public async Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow|null> {
		log.silly("Get:", sql);
		return this.db.prepare(sql).get(parameters || []);
	}

	public async All(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow[]> {
		log.silly("All:", sql);
		return this.db.prepare(sql).all(parameters || []);
	}

	public async Run(sql: string, parameters?: ISqlCommandParameters, returnId?: string): Promise<number> {
		log.silly("Run:", sql);
		const info = await this.db.prepare(sql).run(parameters || []);
		return info.lastInsertRowid;
	}

	public async Close(): Promise<void> {
		this.db.close();
	}

	public async Exec(sql: string): Promise<void> {
		log.silly("Exec:", sql);
		return this.db.exec(sql);
	}
}
