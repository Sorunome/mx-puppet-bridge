/*
Copyright 2019, 2020 mx-puppet-bridge
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

import { IJoinRoomStrategy, MatrixClient } from "matrix-bot-sdk";
import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";

const log = new Log("joinStrategy");

export class PuppetBridgeJoinRoomStrategy implements IJoinRoomStrategy {
	constructor(
		private underlyingStrategy: IJoinRoomStrategy,
		private bridge: PuppetBridge,
	) { }

	public async joinRoom(
		roomIdOrAlias: string,
		userId: string,
		apiCall: (roomIdOrAlias: string) => Promise<string>,
	): Promise<string> {
		try {
			return await apiCall(roomIdOrAlias);
		} catch (err) {
			log.info("Attempting join strategy...");
			let haveBotClient = false;
			let client: MatrixClient | null = null;
			try {
				client = await this.bridge.roomSync.getRoomOp(roomIdOrAlias);
			} catch (err) {
				// as we might use this in migrations, we can't rely on roomSync already existing
				// what we can rely on, however, is the store itself already existing.
				// so we'll use that
				const clientMxid = await this.bridge.store.roomStore.getRoomOp(roomIdOrAlias);
				if (clientMxid && this.bridge.AS.isNamespacedUser(clientMxid)) {
					client = this.bridge.AS.getIntentForUserId(clientMxid).underlyingClient;
				}
			}
			if (!client) {
				haveBotClient = true;
				client = this.bridge.botIntent.underlyingClient;
			}
			const roomId = await client.resolveRoom(roomIdOrAlias);
			if (haveBotClient) {
				client = await this.bridge.roomSync.getRoomOp(roomId);
				if (!client) {
					client = this.bridge.botIntent.underlyingClient;
				}
			}
			await client.inviteUser(userId, roomId);
			if (this.underlyingStrategy) {
				return this.underlyingStrategy.joinRoom(roomId, userId, apiCall);
			} else {
				return apiCall(roomId);
			}
		}
	}
}
