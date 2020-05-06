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
import { PresenceConfig } from "./config";

const log = new Log("PresenceHandler");

export type MatrixPresence = "offline" | "online" | "unavailable";

interface IMatrixPresenceInfo {
	mxid: string;
	presence?: MatrixPresence;
	status?: string;
}

interface IMatrixPresenceStatus {
	presence: MatrixPresence;
	status_msg?: string;
}

export class PresenceHandler {
	private presenceQueue: IMatrixPresenceInfo[];
	private interval: NodeJS.Timeout | null;
	constructor(
		private bridge: PuppetBridge,
		private config: PresenceConfig,
	) {
		this.presenceQueue = [];
	}

	public get queueCount(): number {
		return this.presenceQueue.length;
	}

	public async start() {
		if (!this.config.enabled) {
			// nothing to do...
			return;
		}
		if (this.interval) {
			log.info("Restarting presence handler...");
			this.stop();
		}
		log.info(`Starting presence handler with new interval ${this.config.interval}ms`);
		this.interval = setInterval(await this.processIntervalThread.bind(this),
			this.config.interval);
	}

	public stop() {
		if (!this.interval) {
			log.info("Can not stop interval, not running.");
			return;
		}
		log.info("Stopping presence handler");
		clearInterval(this.interval);
		this.interval = null;
	}

	public set(mxid: string, presence: MatrixPresence) {
		if (!this.handled(mxid)) {
			return;
		}
		log.verbose(`Setting presence of ${mxid} to ${presence}`);
		const index = this.queueIndex(mxid);
		if (index === -1) {
			const p = {
				mxid,
				presence,
			};
			this.presenceQueue.push(p);
			// do this async in the BG for live updates
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixPresence(p);
		} else {
			this.presenceQueue[index].presence = presence;
			// do this async in the BG for live updates
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixPresence(this.presenceQueue[index]);
		}
	}

	public setStatus(mxid: string, status: string) {
		if (!this.handled(mxid)) {
			return;
		}
		log.verbose(`Setting status of ${mxid} to ${status}`);
		const index = this.queueIndex(mxid);
		if (index === -1) {
			const p = {
				mxid,
				status,
			};
			this.presenceQueue.push(p);
			// do this async in the BG for live updates
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixStatus(p);
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixPresence(p);
		} else {
			this.presenceQueue[index].status = status;
			// do this async in the BG for live updates
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixStatus(this.presenceQueue[index]);
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixPresence(this.presenceQueue[index]);
		}
	}

	public setStatusInRoom(mxid: string, roomId: string) {
		if (!this.handled(mxid)) {
			return;
		}
		log.verbose(`Setting status of ${mxid} in ${roomId}`);
		const index = this.queueIndex(mxid);
		if (index === -1) {
			return;
		}
		// tslint:disable-next-line:no-floating-promises
		this.setMatrixStatusInRoom(this.presenceQueue[index], roomId);
	}

	public remove(mxid: string) {
		this.set(mxid, "offline");
	}

	private queueIndex(mxid: string): number {
		return this.presenceQueue.findIndex((p) => p.mxid === mxid);
	}

	private handled(mxid: string): boolean {
		return this.bridge.AS.isNamespacedUser(mxid) && mxid !== this.bridge.botIntent.userId;
	}

	private async processIntervalThread() {
		const info = this.presenceQueue.shift();
		if (info) {
			await this.setMatrixPresence(info);
			if (info.presence !== "offline") {
				this.presenceQueue.push(info);
			} else {
				log.verbose(`Dropping ${info.mxid} from the presence queue.`);
			}
		}
	}

	private async setMatrixPresence(info: IMatrixPresenceInfo) {
		const intent = this.bridge.AS.getIntentForUserId(info.mxid);
		await intent.ensureRegistered();
		const statusObj: IMatrixPresenceStatus = { presence: info.presence || "online" };
		if (info.status) {
			statusObj.status_msg = info.status;
		}
		log.silly(`Updating presence for ${info.mxid} (presence=${info.presence} status=${info.status}})`);
		try {
			// time to set tpe presence
			const client = intent.underlyingClient;
			const userId = encodeURIComponent(await client.getUserId());
			const url = `/_matrix/client/r0/presence/${userId}/status`;
			await client.doRequest("PUT", url, null, statusObj);
		} catch (err) {
			log.info(`Could not update Matrix presence for ${info.mxid}`, err.error || err.body || err);
		}
	}

	private async setMatrixStatus(info: IMatrixPresenceInfo) {
		const rooms = await this.bridge.puppetStore.getRoomsOfGhost(info.mxid);
		for (const roomId of rooms) {
			await this.setMatrixStatusInRoom(info, roomId);
		}
	}

	private async setMatrixStatusInRoom(info: IMatrixPresenceInfo, roomId: string) {
		if (this.config.disableStatusState || (info.presence === "offline" && !info.status)) {
			return;
		}
		const userParts = this.bridge.userSync.getPartsFromMxid(info.mxid);
		if (!userParts || this.config.statusStateBlacklist.includes(userParts.userId)) {
			return;
		}
		const intent = this.bridge.AS.getIntentForUserId(info.mxid);
		await intent.ensureRegistered();
		log.silly(`Sending status for ${info.mxid} into room ${roomId}`);
		const client = intent.underlyingClient;
		const data = {
			status: info.status,
		};
		try {
			await client.sendStateEvent(roomId, "im.vector.user_status", await client.getUserId(), data);
		} catch (err) {
			if (err.body && err.body.errcode === "M_FORBIDDEN" && err.body.error.includes("user_level (0) < send_level (50)")) {
				log.debug("Couldn't set status, trying to raise required power level");
				// ALRIGHT, let's fetch the OP, change the permission needed for status and update again
				const opClient = await this.bridge.roomSync.getRoomOp(roomId);
				if (opClient) {
					try {
						const powerLevels = await opClient.getRoomStateEvent(roomId, "m.room.power_levels", "");
						if (!powerLevels.events) {
							powerLevels.events = {};
						}
						powerLevels.events["im.vector.user_status"] = 0;
						await opClient.sendStateEvent(roomId, "m.room.power_levels", "", powerLevels);
						log.debug("Re-setting status.....");
						await client.sendStateEvent(roomId, "im.vector.user_status", await client.getUserId(), data);
					} catch (err2) {
						log.info(`Couldn't set status for ${info.mxid} in ${roomId}`, err2.error || err2.body || err2);
					}
				} else {
					log.info(`Couldn't set status for ${info.mxid} in ${roomId}`, err.error || err.body || err);
				}
			} else {
				log.info(`Couldn't set status for ${info.mxid} in ${roomId}`, err.error || err.body || err);
			}
		}
	}
}
