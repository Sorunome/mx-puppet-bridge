import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";

const log = new Log("TypingHandler");

export class TypingHandler {
	constructor(
		private bridge: PuppetBridge,
		private timeout: number,
	) { }

	public async set(mxid: string, roomId: string, typing: boolean) {
		if (!this.handled(mxid)) {
			return;
		}
		log.verbose(`Updating typing for ${mxid} in room ${roomId} to ${typing}`);
		try {
			const intent = this.bridge.AS.getIntentForUserId(mxid);
			await intent.ensureRegistered();
			const mxidEnc = encodeURIComponent(mxid);
			const roomIdEnc = encodeURIComponent(roomId);
			const url = `/_matrix/client/r0/rooms/${roomIdEnc}/typing/${mxidEnc}`;
			await intent.underlyingClient.doRequest("PUT", url, null, {
				typing,
				timeout: this.timeout,
			});
		} catch (err) {
			log.warn("Failed to update typing:", err);
		}
	}

	private handled(mxid: string): boolean {
		return this.bridge.AS.isNamespacedUser(mxid) && mxid !== this.bridge.botIntent.userId;
	}
}
