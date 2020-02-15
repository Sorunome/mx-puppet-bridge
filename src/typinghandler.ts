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

import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";
import { ExpireSet } from "./structures/expireset";

const log = new Log("TypingHandler");

export class TypingHandler {
	private typingUsers: ExpireSet<string>;
	constructor(
		private bridge: PuppetBridge,
		private timeout: number,
	) {
		this.typingUsers = new ExpireSet(this.timeout);
	}

	public async set(mxid: string, roomId: string, typing: boolean) {
		if (!this.handled(mxid)) {
			return;
		}
		log.verbose(`Updating typing for ${mxid} in room ${roomId} to ${typing}`);
		const key = `${mxid};${roomId}`;
		if (typing) {
			this.typingUsers.add(key);
		} else {
			if (!this.typingUsers.has(key)) {
				// we weren't typing anyways
				return;
			}
			this.typingUsers.delete(key);
		}
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
			log.warn("Failed to update typing:", err.error || err.body || err);
		}
	}

	private handled(mxid: string): boolean {
		return this.bridge.AS.isNamespacedUser(mxid) && mxid !== this.bridge.botIntent.userId;
	}
}
