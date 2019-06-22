import { IJoinRoomStrategy } from "matrix-bot-sdk";
import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";

const log = new Log("joinStrategy");

export class PuppetBridgeJoinRoomStrategy implements IJoinRoomStrategy {
	constructor(
		private underlyingStrategy: IJoinRoomStrategy,
		private bridge: PuppetBridge,
	) { }

	public async joinRoom(roomIdOrAlias: string, userId: string, apiCall: (roomIdOrAlias: string) => Promise<string>): Promise<string> {
		try {
			return apiCall(roomIdOrAlias);
		} catch (err) {
			log.info("Attempting join strategy...");
			let client = await this.bridge.chanSync.getChanOp(roomIdOrAlias);
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
