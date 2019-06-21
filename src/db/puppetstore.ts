import { IDatabaseConnector } from "./connector";
import { Log } from "../log";

const log = new Log("DbPuppetStore");

export interface IPuppet {
	puppetId: number;
	puppetMxid: string;
	data: any;
}

export class DbPuppetStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public async getAll(): Promise<IPuppet[]> {
		const result = [] as IPuppet[];
		const rows = await this.db.All("SELECT * FROM puppet_store");
		for (const r of rows) {
			try {
				result.push({
					puppetId: r.puppet_id as number,
					puppetMxid: r.puppet_mxid as string,
					data: JSON.parse(r.data as string),
				});
			} catch (err) {
				log.warn(`Unable to decode json data:${err}, skipping puppet ${r.puppet_id}`);
				continue;
			}
		}
		return result;
	}

	public async getMxid(puppetId: number): Promise<string> {
		const result = await this.db.Get("SELECT puppet_mxid FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!result) {
			throw new Error("Puppet not found");
		}
		return result.puppet_mxid as string;
	}
}
