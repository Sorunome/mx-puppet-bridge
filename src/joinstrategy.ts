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

import { IJoinRoomStrategy } from "matrix-bot-sdk";
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
			let client = await this.bridge.roomSync.getRoomOp(roomIdOrAlias);
			if (!client) {
				client = this.bridge.botIntent.underlyingClient;
			}
			const roomId = await client.resolveRoom(roomIdOrAlias);
			await client.inviteUser(userId, roomId);
			if (this.underlyingStrategy) {
				return this.underlyingStrategy.joinRoom(roomId, userId, apiCall);
			} else {
				return apiCall(roomId);
			}
		}
	}
}
