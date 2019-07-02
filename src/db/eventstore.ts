import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";

const log = new Log("DbEventStore");

export class DbEventStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public async insert(puppetId: number, matrixId: string, remoteId: string) {
		await this.db.Run("INSERT INTO event_store (puppet_id, matrix_id, remote_id) VALUES ($p, $m, $r)", {
			p: puppetId,
			m: matrixId,
			r: remoteId,
		});
	}

	public async getMatrix(puppetId: number, remoteId: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM event_store WHERE puppet_id=$p AND remote_id=$r", {
			p: puppetId,
			r: remoteId,
		});
		for (const row of rows) {
			result.push(row.matrix_id as string);
		}
		return result;
	}

	public async getRemote(puppetId: number, matrixId: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM event_store WHERE puppet_id=$p AND matrix_id=$m", {
			p: puppetId,
			m: matrixId,
		});
		for (const row of rows) {
			result.push(row.remote_id as string);
		}
		return result;
	}
}
