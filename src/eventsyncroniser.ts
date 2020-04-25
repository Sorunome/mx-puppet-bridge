/*
Copyright 2020 mx-puppet-bridge
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

import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";
import { DbEventStore } from "./db/eventstore";
import { IRemoteRoom } from "./interfaces";

const log = new Log("EventSyncroniser");

export class EventSyncroniser {
	private eventStore: DbEventStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.eventStore = this.bridge.eventStore;
	}

	public async insert(room: IRemoteRoom, matrixId: string, remoteId?: string) {
		if (remoteId) {
			const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(room.puppetId);
			await this.eventStore.insert(dbPuppetId, room.roomId, matrixId, remoteId);
		}
		// we have registered this event, so we might as well mark it as read
		try {
			const roomId = await this.bridge.roomSync.maybeGetMxid(room);
			if (roomId) {
				await this.bridge.botIntent.underlyingClient.sendReadReceipt(roomId, matrixId);
			}
		} catch (err) {
			log.silly("Failed to send read reciept", err);
		}
	}

	public async remove(room: IRemoteRoom, remoteId: string) {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(room.puppetId);
		await this.eventStore.remove(dbPuppetId, room.roomId, remoteId);
	}

	public async getMatrix(room: IRemoteRoom, remoteId: string): Promise<string[]> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(room.puppetId);
		return await this.eventStore.getMatrix(dbPuppetId, room.roomId, remoteId);
	}

	public async getRemote(room: IRemoteRoom, matrixId: string): Promise<string[]> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(room.puppetId);
		return await this.eventStore.getRemote(dbPuppetId, room.roomId, matrixId);
	}
}
