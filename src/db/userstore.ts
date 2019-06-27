import { IDatabaseConnector } from "./connector";
import { Log } from "../log";
import { TimedCache } from "../structures/timedcache";

const log = new Log("DbUserStore");

const USERS_CACHE_LIFETIME = 1000*60*60*24;

export interface IUserStoreEntry {
	puppetId: number;
	userId: string;
	name?: string | null;
	avatarUrl?: string | null;
	avatarMxc?: string | null;
	avatarHash?: string | null;
}

export class DbUserStore {
	private usersCache: TimedCache<string, IUserStoreEntry>;
	constructor(
		private db: IDatabaseConnector,
	) {
		this.usersCache = new TimedCache(USERS_CACHE_LIFETIME);
	}

	public newData(puppetId: number, userId: string): IUserStoreEntry {
		return {
			puppetId,
			userId,
		} as IUserStoreEntry;
	}

	public async get(puppetId: number, userId: string): Promise<IUserStoreEntry | null> {
		const cacheKey = `${puppetId};${userId}`;
		const cached = this.usersCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const row = await this.db.Get(
			"SELECT * FROM user_store WHERE user_id = $id AND puppet_id = $pid", {id: userId, pid: puppetId},
		);
		if (!row) {
			return null;
		}
		const data = this.newData(puppetId, userId);
		data.name = row.name as string|null;
		data.avatarUrl = row.avatar_url as string | null;
		data.avatarMxc = row.avatar_mxc as string |null;
		data.avatarHash = row.avatar_hash as string | null;
		this.usersCache.set(cacheKey, data);
		return data;
	}

	public async set(data: IUserStoreEntry) {
		const exists = await this.db.Get(
			"SELECT * FROM user_store WHERE user_id = $id AND puppet_id = $pid", {id: data.userId, pid: data.puppetId},
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO user_store (
				user_id,
				puppet_id,
				name,
				avatar_url,
				avatar_mxc,
				avatar_hash
			) VALUES (
				$user_id,
				$puppet_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$avatar_hash
			)`;
		} else {
			query = `UPDATE user_store SET
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				avatar_hash = $avatar_hash
				WHERE user_id = $user_id AND puppet_id = $puppet_id`;
		}
		await this.db.Run(query, {
			user_id: data.userId,
			puppet_id: data.puppetId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			avatar_hash: data.avatarHash || null,
		});
		const cacheKey = `${data.puppetId};${data.userId}`;
		this.usersCache.set(cacheKey, data);
	}
}
