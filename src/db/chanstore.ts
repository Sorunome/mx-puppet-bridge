import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";

const log = new Log("DbChanStore");

export interface IChanStoreEntry {
	mxid: string;
	roomId: string;
	puppetId: number;
	name?: string | null;
	avatarUrl?: string | null;
	avatarMxc?: string | null;
	topic?: string | null;
}

export class DbChanStore {
	constructor (
		private db:IDatabaseConnector,
	) { }

	public newData(mxid: string, roomId: string, puppetId: number): IChanStoreEntry {
		return {
			mxid,
			roomId,
			puppetId,
		} as IChanStoreEntry;
	}

	public async getByRemote(roomId: string, puppetId: number) {
		const row = await this.db.Get(
			"SELECT * FROM chan_store WHERE room_id = $room_id AND puppet_id = $puppet_id", {
			room_id: roomId,
			puppet_id: puppetId,
		});
		return this.getFromRow(row);
	}

	public async getByMxid(mxid: string) {
		const row = await this.db.Get(
			"SELECT * FROM chan_store WHERE mxid = $mxid", { mxid }
		);
		return this.getFromRow(row);
	}

	public async set(data:IChanStoreEntry) {
		const exists = await this.db.Get(
			"SELECT * FROM chan_store WHERE mxid = $mxid", {mxid: data.mxid}
		);
		let query = "";
		if (!exists) {
			query = `INSERT INTO chan_store (
				mxid,
				room_id,
				puppet_id,
				name,
				avatar_url,
				avatar_mxc,
				topic
			) VALUES (
				$mxid,
				$room_id,
				$puppet_id,
				$name,
				$avatar_url,
				$avatar_mxc,
				$topic
			)`;
		} else {
			query = `UPDATE chan_store SET
				room_id = $room_id,
				puppet_id = $puppet_id,
				name = $name,
				avatar_url = $avatar_url,
				avatar_mxc = $avatar_mxc,
				topic = $topic
				WHERE mxid = $mxid`;
		}
		await this.db.Run(query, {
			mxid: data.mxid,
			room_id: data.roomId,
			puppet_id: data.puppetId,
			name: data.name || null,
			avatar_url: data.avatarUrl || null,
			avatar_mxc: data.avatarMxc || null,
			topic: data.topic || null,
		});
	}

	private getFromRow(row: ISqlRow | null): IChanStoreEntry | null {
		if (!row) {
			return null;
		}
		const result = this.newData(
			row.mxid as string,
			row.room_id as string,
			row.puppet_id as number,
		);
		result.name = row.name as string | null;
		result.avatarUrl = row.avatar_url as string | null;
		result.avatarMxc = row.avatar_mxc as string | null;
		result.topic = row.topic as string | null;
		return result;
	}
}
