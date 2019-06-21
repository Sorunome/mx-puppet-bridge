import { PuppetBridge } from "./puppetbridge";
import { Util } from "./util";
import { Log } from "./log";
import { DbChanStore } from "./db/chanstore";

const log = new Log("ChannelSync");

export interface IRemoteChanSend {
	roomId: string;
	puppetId: number;
};

export interface IRemoteChanReceive {
	data?: any;
	roomId: string;
	puppetId: number;

	avatarUrl?: string | null;
	name?: string | null;
	topic?: string | null;
}

export class ChannelSyncroniser {
	private chanStore: DbChanStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.chanStore = this.bridge.chanStore;
	}

	public async getRemoteHandler(mxid: string): Promise<IRemoteChanSend | null> {
		const chan = await this.chanStore.getByMxid(mxid);
		if (!chan) {
			return null;
		}
		return {
			roomId: chan.roomId,
			puppetId: chan.puppetId,
		} as IRemoteChanSend;
	}

	public async getMxid(data: IRemoteChanReceive) {
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${data.puppetId}`);
		let chan = await this.chanStore.getByRemote(data.roomId, data.puppetId);
		const update = {
			name: false,
			avatar: false,
			topic: false,
		};
		const intent = this.bridge.botIntent;
		let mxid = "";
		let doUpdate = false;
		if (!chan) {
			log.info("Channel doesn't exist yet, creating entry...");
			doUpdate = true;
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			update.topic = data.topic ? true : false;
			// ooookay, we need to create this channel
			mxid = await intent.underlyingClient.createRoom({
				visibilitvisibility: "private",
				preset: "trusted_private_chat",
			});
			chan = this.chanStore.newData(mxid, data.roomId, data.puppetId);
		} else {
			update.name = data.name !== undefined && data.name !== chan.name;
			update.avatar = data.avatarUrl !== undefined && data.avatarUrl !== chan.avatarUrl;
			update.topic = data.topic !== undefined && data.topic !== chan.topic;
			mxid = chan.mxid; 
		}
		if (update.name) {
			log.verbose("Updating name");
			await intent.underlyingClient.sendStateEvent(
				mxid,
				"m.room.name",
				"",
				{ name: data.name },
			);
			chan.name = data.name;
		}
		if (update.avatar) {
			log.verbose("Updating avatar");
			if (data.avatarUrl) {
				const avatarData = await Util.DownloadFile(data.avatarUrl);
				const avatarMxc = await intent.underlyingClient.uploadContent(
					avatarData,
					Util.GetMimeType(avatarData), // TOOD: mimetype
				);
				chan.avatarMxc = avatarMxc;
			} else {
				// remove the avatar URL
				chan.avatarMxc = undefined;
			}
			await intent.underlyingClient.sendStateEvent(
				mxid,
				"m.room.avatar",
				"",
				{ avatar_url: chan.avatarMxc },
			);
			chan.avatarUrl = data.avatarUrl;
		}
		if (update.topic) {
			log.verbose("updating topic");
			await intent.underlyingClient.sendStateEvent(
				mxid,
				"m.room.topic",
				"",
				{ topic: data.topic },
			);
			chan.topic = data.topic;
		}

		for (const k of Object.keys(update)) {
			if (update[k]) {
				doUpdate = true;
				break;
			}
		}

		if (doUpdate) {
			log.verbose("Storing update to DB");
			await this.chanStore.set(chan);
		}

		return mxid;
	}
}
