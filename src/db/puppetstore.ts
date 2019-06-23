import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";
import { TimedCache } from "../structures/timedcache";

const log = new Log("DbPuppetStore");

const PUPPET_CACHE_LIFETIME = 1000*60*60*24;

export interface IPuppet {
	puppetId: number;
	puppetMxid: string;
	data: any;
	userId: string | null;
}

export class DbPuppetStore {
	private mxidCache: TimedCache<number, string>;
	constructor(
		private db: IDatabaseConnector,
	) {
		this.mxidCache = new TimedCache(PUPPET_CACHE_LIFETIME);
	}

	public async getAll(): Promise<IPuppet[]> {
		const result = [] as IPuppet[];
		const rows = await this.db.All("SELECT * FROM puppet_store");
		for (const r of rows) {
			const res = this.getRow(r);
			if (res) {
				result.push(res);
			}
		}
		return result;
	}

	public async get(puppetId: number): Promise<IPuppet | null> {
		const row = await this.db.Get("SELECT * FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!row) {
			return null;
		}
		return this.getRow(row);
	}

	public async getMxid(puppetId: number): Promise<string> {
		const cached = this.mxidCache.get(puppetId);
		if (cached) {
			return cached;
		}
		const result = await this.db.Get("SELECT puppet_mxid FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		if (!result) {
			throw new Error("Puppet not found");
		}
		const mxid = result.puppet_mxid as string;
		this.mxidCache.set(puppetId, mxid);
		return mxid;
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.db.Run("UPDATE puppet_store SET user_id=$uid WHERE puppet_id=$pid", {
			uid: userId,
			pid: puppetId,
		});
	}

	public async setData(puppetId: number, data: any) {
		let dataStr = "";
		try {
			dataStr = JSON.stringify(data);
		} catch (err) {
			log.warn("Error stringifying json:", err);
			return;
		}
		await this.db.Run("UPDATE puppet_store SET data=$d WHERE puppet_id=$id", {
			d: dataStr,
			id: puppetId,
		});
	}

	private getRow(row: ISqlRow): IPuppet | null {
		try {
			return {
				puppetId: row.puppet_id as number,
				puppetMxid: row.puppet_mxid as string,
				data: JSON.parse(row.data as string),
				userId: row.user_id as string | null,
			} as IPuppet;
		} catch (err) {
			log.warn(`Unable to decode json data:${err} on puppet ${row.puppet_id}`);
			return null;
		}
	}
}
