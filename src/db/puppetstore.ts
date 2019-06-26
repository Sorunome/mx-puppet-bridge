import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";
import { TimedCache } from "../structures/timedcache";
import { Lock } from "../structures/lock";

const log = new Log("DbPuppetStore");

const PUPPET_CACHE_LIFETIME = 1000*60*60*24;
const MXID_INFO_LOCK_TIMEOUT = 1000;

export interface IPuppet {
	puppetId: number;
	puppetMxid: string;
	data: any;
	userId: string | null;
}

export interface IMxidInfo {
	puppetMxid: string;
	name: string | null;
	avatarMxc: string | null;
	avatarUrl: string | null;
	token: string | null;
}

export class DbPuppetStore {
	private mxidCache: TimedCache<number, string>;
	private mxidInfoLock: Lock<string>;
	constructor(
		private db: IDatabaseConnector,
	) {
		this.mxidCache = new TimedCache(PUPPET_CACHE_LIFETIME);
		this.mxidInfoLock = new Lock(MXID_INFO_LOCK_TIMEOUT);
	}

	public async getMxidInfo(puppetMxid: string): Promise<IMxidInfo | null> {
		const row = await this.db.Get("SELECT * FROM puppet_mxid_store WHERE puppet_mxid=$id", { id: puppetMxid });
		if (!row) {
			return null;
		}
		return {
			puppetMxid,
			name: row.name as string | null,
			avatarMxc: row.avatar_mxc as string | null,
			token: row.token as string | null,
		} as IMxidInfo;
	}

	public async getOrCreateMxidInfo(puppetMxid: string): Promise<IMxidInfo> {
		await this.mxidInfoLock.wait(puppetMxid);
		this.mxidInfoLock.set(puppetMxid);
		const puppet = await this.getMxidInfo(puppetMxid);
		if (puppet) {
			this.mxidInfoLock.release(puppetMxid);
			return puppet;
		}
		const p = {
			puppetMxid,
			name: null,
			avatarMxc: null,
			token: null,
		} as IMxidInfo;
		await this.setMxidInfo(p);
		this.mxidInfoLock.release(puppetMxid);
		return p;
	}

	public async setMxidInfo(puppet: IMxidInfo) {
		const exists = await this.db.Get("SELECT * FROM puppet_mxid_store WHERE puppet_mxid=$id", { id: puppet.puppetMxid });
		let query = "";
		if (!exists) {
			query = `INSERT INTO puppet_mxid_store (
				puppet_mxid,
				name,
				avatar_mxc,
				token
			) VALUES (
				$puppetMxid,
				$name,
				$avatarMxc,
				$token
			)`;
		} else {
			query = `UPDATE puppet_mxid_store SET 
				name = $name,
				avatar_mxc = $avatarMxc,
				token = $token
				WHERE puppet_mxid = $puppetMxid`;
		}
		await this.db.Run(query, {
			puppetMxid: puppet.puppetMxid,
			name: puppet.name || null,
			avatarMxc: puppet.avatarMxc || null,
			token: puppet.token || null,
		});
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

	public async getForMxid(puppetMxid: string): Promise<IPuppet[]> {
		const result = [] as IPuppet[];
		const rows = await this.db.All("SELECT * FROM puppet_store WHERE puppet_mxid=$mxid", { mxid: puppetMxid });
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

	public async new(puppetMxid: string, data: any, userId?: string): Promise<number> {
		let dataStr = "";
		try {
			dataStr = JSON.stringify(data);
		} catch (err) {
			log.warn("Error strinifying json:", err);
			return -1;
		}
		const puppetId = await this.db.Run("INSERT INTO puppet_store (puppet_mxid, data, user_id) VALUES ($mxid, $data, $uid)", {
			mxid: puppetMxid,
			data: dataStr,
			uid: userId || null,
		}, "puppet_id");
		return puppetId;
	}

	public async delete(puppetId: number) {
		await this.db.Run("DELETE FROM puppet_store WHERE puppet_id=$id", { id: puppetId });
		this.mxidCache.delete(puppetId);
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
