import { PuppetBridge } from "./puppetbridge";
import { Log } from "./log";

const log = new Log("PresenceHandler");

export type MatrixPresence = "offline" | "online" | "unavailable";

interface IMatrixPresenceInfo {
	mxid: string;
	presence?: MatrixPresence;
	status?: string;
}

interface IMatrixPresenceStatus {
	presence?: MatrixPresence;
	status_msg?: string;
}

export class PresenceHandler {
	private presenceQueue: IMatrixPresenceInfo[];
	private interval: NodeJS.Timeout | null;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.presenceQueue = [];
	}

	get queueCount(): number {
		return this.presenceQueue.length;
	}

	public async start(intervalTime: number) {
		if (this.interval) {
			log.info("Restarting presence handler...");
			this.stop();
		}
		log.info(`Starting presence handler with new interval ${intervalTime}ms`);
		this.interval = setInterval(await this.processIntervalThread.bind(this),
			intervalTime);
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
			this.setMatrixPresence(p);
		} else {
			this.presenceQueue[index].status = status;
			// do this async in the BG for live updates
			// tslint:disable-next-line:no-floating-promises
			this.setMatrixPresence(this.presenceQueue[index]);
		}
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
		const statusObj: IMatrixPresenceStatus = {presence: info.presence};
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
		} catch (ex) {
			log.info(`Could not update Matrix presence for ${info.mxid}`);
		}
	}
}
