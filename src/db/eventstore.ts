/*
Copyright 2019 mx-puppet-bridge
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

import { IDatabaseConnector, ISqlRow } from "./connector";
import { Log } from "../log";

const log = new Log("DbEventStore");

export class DbEventStore {
	constructor(
		private db: IDatabaseConnector,
	) { }

	public async insert(puppetId: number, roomId: string, matrixId: string, remoteId: string) {
		await this.db.Run("INSERT INTO event_store (puppet_id, room_id, matrix_id, remote_id) VALUES ($p, $room, $m, $r)", {
			p: puppetId,
			room: roomId,
			m: matrixId,
			r: remoteId,
		});
	}

	public async remove(puppetId: number, roomId: string, remoteId: string) {
		await this.db.Run("DELETE FROM event_store WHERE puppet_id = $p AND room_id = $room AND remote_id = $r", {
			p: puppetId,
			room: roomId,
			r: remoteId,
		});
	}

	public async getMatrix(puppetId: number, roomId: string, remoteId: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM event_store WHERE puppet_id=$p AND room_id = $room AND remote_id=$r", {
			p: puppetId,
			room: roomId,
			r: remoteId,
		});
		for (const row of rows) {
			result.push(row.matrix_id as string);
		}
		return result;
	}

	public async getRemote(puppetId: number, roomId: string, matrixId: string): Promise<string[]> {
		const result: string[] = [];
		const rows = await this.db.All("SELECT * FROM event_store WHERE puppet_id = $p AND room_id = $room AND matrix_id = $m", {
			p: puppetId,
			room: roomId,
			m: matrixId,
		});
		for (const row of rows) {
			result.push(row.remote_id as string);
		}
		return result;
	}
}
