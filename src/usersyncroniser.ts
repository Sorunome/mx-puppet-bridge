import { PuppetBridge } from "./puppetbridge";
import { MatrixClient } from "matrix-bot-sdk";
import { Util } from "./util";
import { Log } from "./log";
import { DbUserStore } from "./db/userstore";

const log = new Log("UserSync");

export interface IRemoteUserReceive {
	userId: string;
	
	avatarUrl?: string | null;
	name?: string | null;
}

export class UserSyncroniser {
	private userStore: DbUserStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.userStore = this.bridge.userStore;
	}

	public async getClient(data: IRemoteUserReceive): Promise<{client: MatrixClient; created: boolean;}> {
		log.info("Fetching client for " + data.userId);
		let user = await this.userStore.get(data.userId);
		const update = {
			name: false,
			avatar: false,
		};
		let doUpdate = false;
		let created = false;
		if (!user) {
			doUpdate = true;
			log.info("User doesn't exist yet, creating entry...");
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			user = this.userStore.newData(data.userId);
			created = true;
		} else {
			update.name = data.name !== undefined && data.name !== user.name;
			update.avatar = data.avatarUrl !== undefined && data.avatarUrl !== user.avatarUrl;
		}
		const intent = this.bridge.AS.getIntentForSuffix(Util.str2mxid(data.userId));
		const client = intent.underlyingClient;
		if (update.name) {
			log.verbose("Updating name");
			client.setDisplayName(data.name || "");
			user.name = data.name;
		}
		if (update.avatar) {
			log.verbose("Updating avatar");
			if (data.avatarUrl) {
				const avatarData = await Util.DownloadFile(data.avatarUrl);
				const avatarMxc = await client.uploadContent(
					avatarData,
					Util.GetMimeType(avatarData),
				);
				user.avatarMxc = avatarMxc;
			} else {
				// remove the avatar URL
				user.avatarMxc = undefined;
			}
			await client.setAvatarUrl(user.avatarMxc || "");
			user.avatarUrl = data.avatarUrl;
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

		return { client, created };
	}
}
