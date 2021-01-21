/*
Copyright 2018, 2019 matrix-appservice-discord

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

import * as pgPromise from "pg-promise";
import { Log } from "../log";
import { IDatabaseConnector, ISqlCommandParameters, ISqlRow } from "./connector";
import * as prometheus from "prom-client";
const log = new Log("Postgres");

const pgp: pgPromise.IMain = pgPromise({
	// Initialization Options
});

export class Postgres implements IDatabaseConnector {
	public static ParameterizeSql(sql: string): string {
		return sql.replace(/\$((\w|\d|_)+)+/g, (k) => {
			return `\${${k.substr("$".length)}}`;
		});
	}

	public type = "postgres";
	public latency: prometheus.Histogram<string>;

	// tslint:disable-next-line no-any
	private db: pgPromise.IDatabase<any>;
	constructor(private connectionString: string) {
		this.latency = new prometheus.Histogram({
			name: "bridge_database_query_seconds",
			help: "Time spent querying the database engine",
			labelNames: ["protocol", "engine", "type", "table"],
			// tslint:disable-next-line no-magic-numbers
			buckets: [0.002, 0.005, 0.0075, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
		});
	}
	public Open() {
		// Hide username:password
		const logConnString = this.connectionString.substr(
			this.connectionString.indexOf("@") || 0,
		);
		log.info(`Opening ${logConnString}`);
		this.db = pgp(this.connectionString);
	}

	public async Get(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow|null> {
		log.silly("Get:", sql);
		return this.db.oneOrNone(Postgres.ParameterizeSql(sql), parameters);
	}

	public async All(sql: string, parameters?: ISqlCommandParameters): Promise<ISqlRow[]> {
		log.silly("All:", sql);
		try {
			return await this.db.many(Postgres.ParameterizeSql(sql), parameters);
		} catch (ex) {
			if (ex.code === pgPromise.errors.queryResultErrorCode.noData ) {
				return [];
			}
			throw ex;
		}
	}

	public async Run(sql: string, parameters?: ISqlCommandParameters, returnId?: string): Promise<number> {
		if (returnId) {
			sql += ` RETURNING ${returnId}`;
		}
		log.silly("Run:", sql);
		return this.db.oneOrNone(Postgres.ParameterizeSql(sql), parameters).then((row) => {
			if (!row || !returnId) {
				return -1;
			}
			return Number(row[returnId]);
		});
	}

	public async Close(): Promise<void> {
		// Postgres doesn't support disconnecting.
	}

	public async Exec(sql: string): Promise<void> {
		log.silly("Exec:", sql);
		await this.db.none(sql);
		return;
	}
}
