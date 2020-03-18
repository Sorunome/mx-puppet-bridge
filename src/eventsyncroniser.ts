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

const log = new Log("EventSyncroniser");

export class EventSyncroniser {
	private eventStore: DbEventStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.eventStore = this.bridge.eventStore;
	}

	public async insert(puppetId: number, matrixId: string, remoteId: string) {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		await this.eventStore.insert(dbPuppetId, matrixId, remoteId);
	}

	public async remove(puppetId: number, remoteId: string) {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		await this.eventStore.remove(dbPuppetId, remoteId);
	}

	public async getMatrix(puppetId: number, remoteId: string): Promise<string[]> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		return await this.eventStore.getMatrix(dbPuppetId, remoteId);
	}

	public async getRemote(puppetId: number, matrixId: string): Promise<string[]> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		return await this.eventStore.getRemote(dbPuppetId, matrixId);
	}
}
