import { IDatabaseConnector } from "./connector";
import { Log } from "../log";

const log = new Log("DbUserStore");

export interface IUserStoreEntry {
	userId: string;
	name?: string | null;
	avatarUrl?: string | null;
	avatarMxc?: string | null;
}

export class DbUserStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public newData(userId: string): IUserStoreEntry {
		return {
			userId,
		} as IUserStoreEntry;
	}

	public async get(userId: string): Promise<IUserStoreEntry | null> {
		const row = await this.db.Get(
			"SELECT * FROM user_store WHERE user_id = $id", {id: userId},
		);
		if (!row) {
			return null;
		}
		const data = this.newData(userId);
		data.name = row.name as string|null;
		data.avatarUrl = row.avatar_url as string|null;
		data.avatarMxc = row.avatar_mxc as string|null;
		return data;
	}

	public async set(data: IUserStoreEntry) {
		const exists = await this.db.Get(
			"SELECT * FROM user_store WHERE user_id = $id", {id: data.userId},
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO user_store (
				user_id,
				name,
				avatar_url,
				avatar_mxc
			) VALUES (
				$user_id,
				$name,
				$avatar_url,
				$avatar_mxc
			)`;
		} else {
			query = `UPDATE user_store SET
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc
				WHERE user_id = $user_id`;
		}
		await this.db.Run(query, {
			user_id: data.userId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
		});
	}
}
