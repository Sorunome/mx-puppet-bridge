import { PuppetBridge } from "./puppetbridge";
import { Intent } from "matrix-bot-sdk";
import { Util } from "./util";
import { Log } from "./log";
import { DbUserStore } from "./db/userstore";

const log = new Log("UserSync");

export interface IRemoteUserReceive {
	userId: string;
	
	avatarUrl?: string;
	name?: string;
}

export class UserSyncroniser {
	private userStore: DbUserStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.userStore = this.bridge.userStore;
	}

	public async getIntent(data: IRemoteUserReceive): Promise<Intent> {
		log.info("Fetching intent for " + data.userId);
		let user = await this.userStore.get(data.userId);
		const update = {
			name: false,
			avatar: false,
		};
		if (!user) {
			log.info("User doesn't exist yet, creating entry...");
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			user = this.userStore.newData(data.userId);
		} else {
			update.name = data.name !== user.name;
			update.avatar = data.avatarUrl !== user.avatarUrl;
		}
		const intent = this.bridge.AS.getIntentForSuffix(data.userId);
		if (update.name) {
			log.verbose("Updating name");
			intent.underlyingClient.setDisplayName(data.name || "");
			user.name = data.name;
		}
		if (update.avatar) {
			log.verbose("Updating avatar");
			if (data.avatarUrl) {
				const avatarData = await Util.DownloadFile(data.avatarUrl);
				const avatarMxc = await intent.underlyingClient.uploadContent(
					avatarData,
					Util.GetMimeType(avatarData),
				);
				user.avatarMxc = avatarMxc;
			} else {
				// remove the avatar URL
				user.avatarMxc = undefined;
			}
			await intent.underlyingClient.setAvatarUrl(user.avatarMxc || "");
			user.avatarUrl = data.avatarUrl;
		}

		let doUpdate = false;
		for (const k in Object.keys(update)) {
			if (update[k]) {
				doUpdate = true;
				break;
			}
		}
		if (doUpdate) {
			log.verbose("Storing update to DB");
			await this.userStore.set(user);
		}

		return intent;
	}
}
