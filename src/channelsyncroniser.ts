import { PuppetBridge } from "./puppetbridge";
import { Util } from "./util";

export interface IRemoteChanSend {
	roomId: string;
	puppetId: string;
};

export interface IRemoteChanReceive {
	data?: any;
	roomId: string;
	puppetId: string;

	avatarUrl?: string;
	name?: string;
	topic?: string;
}

export class ChannelSyncroniser {
	private chanStore: ChanStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.chanStore = this.bridge.ChanStore;
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
		let chan = await this.chanStore.getByRemote(data.roomId, data.puppetId);
		const update = {
			name: false,
			avatar: false,
			topic: false,
		};
		const intent = this.bridge.botIntent;
		let mxid = "";
		if (!chan) {
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			update.topic = data.topic ? true : false;
			// ooookay, we need to create this channel
			mxid = await intent.underlyingClient.createRoom({
				visibilitvisibility: "private",
				preset: "trusted_private_chat",
			});
			chan = {
				mxid,
				roomId: data.roomId,
				puppetId: data.puppetId,
			};
		} else {
			update.name = data.name !== chan.name;
			update.avatar = data.avatarUrl !== chan.avatarUrl;
			update.topic = data.topic !== chan.topic;
			mxid = chan.mxid; 
		}
		if (update.name) {
			await intent.underlyingClient.sendStateEvent(
				mxid,
				"m.room.name",
				"",
				{ name: data.name },
			);
			chan.name = data.name;
		}
		if (update.avatar) {
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
			await intent.underlyingClient.sendStateEvent(
				mxid,
				"m.room.topic",
				"",
				{ topic: data.topic },
			);
			chan.topic = data.topic;
		}

		let doUpdate = false;
		for (const k in Object.keys(update)) {
			if (update[k]) {
				doUpdate = true;
				break;
			}
		}

		if (doUpdate) {
			await this.chanStore.set(chan);
		}

		return mxid;
	}
}
