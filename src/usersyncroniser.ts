import { PuppetBridge } from "./puppetbridge";
import { MatrixClient, Intent } from "matrix-bot-sdk";
import { Util } from "./util";
import { Log } from "./log";
import { DbUserStore } from "./db/userstore";
import { Lock } from "./structures/lock";

const log = new Log("UserSync");

const CLIENT_LOOKUP_LOCK_TIMEOUT = 1000*60;

export interface IRemoteUser {
	userId: string;
	puppetId: number;
	
	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
	name?: string | null;
}

export class UserSyncroniser {
	private userStore: DbUserStore;
	private clientLock: Lock<string>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.userStore = this.bridge.userStore;
		this.clientLock = new Lock(CLIENT_LOOKUP_LOCK_TIMEOUT);
	}

	public async getClient(data: IRemoteUser): Promise<MatrixClient> {
		await this.clientLock.wait(data.userId);
		log.info("Fetching client for " + data.userId);
		let user = await this.userStore.get(data.puppetId, data.userId);
		const update = {
			name: false,
			avatar: false,
		};
		let doUpdate = false;
		if (!user) {
			log.info("User doesn't exist yet, creating entry...");
			this.clientLock.set(data.userId);
			doUpdate = true;
			// let's fetch the create data via hook
			if (this.bridge.hooks.createUser) {
				log.verbose("Fetching new override data...");
				const newData = await this.bridge.hooks.createUser(data.puppetId, data.userId);
				if (newData && newData.userId === data.userId && newData.puppetId === data.puppetId) {
					data = newData;
				} else {
					log.warn("Override data is malformed! Old data:", data, "New data:", newData);
				}
			}
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			user = this.userStore.newData(data.puppetId, data.userId);
		} else {
			update.name = data.name !== undefined && data.name !== user.name;
			update.avatar = data.avatarUrl !== undefined && data.avatarUrl !== user.avatarUrl;
		}
		const intent = this.bridge.AS.getIntentForSuffix(`${data.puppetId}_${Util.str2mxid(data.userId)}`);
		await intent.ensureRegistered();
		const client = intent.underlyingClient;
		if (update.name) {
			log.verbose("Updating name");
			client.setDisplayName(data.name || "");
			user.name = data.name;
		}
		if (update.avatar || data.avatarBuffer) {
			log.verbose("Updating avatar");
			const { doUpdate, mxcUrl, hash } = await Util.MaybeUploadFile(client, data, user.avatarHash);
			if (doUpdate) {
				update.avatar = true;
				user.avatarUrl = data.avatarUrl;
				user.avatarHash = hash;
				user.avatarMxc = mxcUrl;
				// we *don't* await here as that can take rather long
				// and we might as well do this in the background
				client.setAvatarUrl(user.avatarMxc || "");
			}
		}

		for (const k of Object.keys(update)) {
			if (update[k]) {
				doUpdate = true;
				break;
			}
		}
		if (doUpdate) {
			log.verbose("Storing update to DB");
			await this.userStore.set(user);
		}

		this.clientLock.release(data.userId);

		return client;
	}

	public getPartsFromMxid(mxid: string): {puppetId: number; userId: string} | null {
		const suffix = this.bridge.AS.getSuffixForUserId(mxid);
		if (!suffix) {
			return null;
		}
		const matches = suffix.match(/^(\d+)_(.*)/);
		if (!matches) {
			return null;
		}
		const puppetId = Number(matches[1]);
		const userId = Util.mxid2str(matches[2]);
		if (isNaN(puppetId)) {
			return null;
		}
		return {
			puppetId,
			userId,
		};
	}

	public async deleteForMxid(mxid: string): Promise<Intent | null> {
		const user = this.getPartsFromMxid(mxid);
		if (!user) {
			return null;
		}
		log.info(`Deleting ghost ${mxid}`);
		await this.userStore.delete(user);
		const intent = this.bridge.AS.getIntentForUserId(mxid);
		return intent;
	}
}
