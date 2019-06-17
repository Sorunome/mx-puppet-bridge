import { IDatabaseConnector } from "./connector";
import { Log } from "../log";

const log = new Log("DbPuppetStore");

export interface IPuppet {
	puppetId: string;
	data: any;
}

export class DbPuppetStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public async getAll(): Promise<IPuppet[]> {
		const result = [] as IPuppet[];
		const rows = await this.db.All("SELECT * FROM puppets");
		for (const r of rows) {
			try {
				result.push({
					puppetId: r.puppet_id as string,
					data: JSON.parse(r.data as string),
				});
			} catch (err) {
				log.warn(`Unable to decode json data:${err}, skipping puppet ${r.puppet_id}`);
				continue;
			}
		}
		return result;
	}
}
