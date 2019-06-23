import { PuppetBridge } from "./puppetbridge";
import { Util } from "./util";
import { Log } from "./log";
import { DbChanStore } from "./db/chanstore";
import { MatrixClient } from "matrix-bot-sdk";
import { Lock } from "./structures/lock";

const log = new Log("ChannelSync");

const MXID_LOOKUP_LOCK_TIMEOUT = 1000*60;

export interface IRemoteChanSend {
	roomId: string;
	puppetId: number;
};

export interface IRemoteChanReceive {
	roomId: string;
	puppetId: number;

	avatarUrl?: string | null;
	name?: string | null;
	topic?: string | null;
	isDirect?: boolean | null;
}

export class ChannelSyncroniser {
	private chanStore: DbChanStore;
	private mxidLock: Lock<string>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.chanStore = this.bridge.chanStore;
		this.mxidLock = new Lock(MXID_LOOKUP_LOCK_TIMEOUT);
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

	public async getChanOp(chan: string): Promise<MatrixClient|null> {
		const mxid = await this.chanStore.getChanOp(chan);
		if (!mxid) {
			return null;
		}
		if (!this.bridge.AS.isNamespacedUser(mxid)) {
			// TODO: logic if puppeted
			return null;
		}
		return this.bridge.AS.getIntentForUserId(mxid).underlyingClient;
	}

	public async getMxid(data: IRemoteChanReceive, client?: MatrixClient, invites?: string[]): Promise<{mxid: string; created: boolean;}> {
		const lockKey = `${data.puppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${data.puppetId}`);
		if (!client) {
			client = this.bridge.botIntent.underlyingClient;
		}
		let chan = await this.chanStore.getByRemote(data.puppetId, data.roomId);
		const update = {
			name: false,
			avatar: false,
			topic: false,
		};
		let mxid = "";
		let doUpdate = false;
		let created = false;
		if (!chan) {
			log.info("Channel doesn't exist yet, creating entry...");
			this.mxidLock.set(lockKey);
			doUpdate = true;
			// let's fetch the create data via hook
			if (this.bridge.hooks.createChan) {
				const newData = await this.bridge.hooks.createChan(data.puppetId, data.roomId);
				if (newData && newData.puppetId === data.puppetId && newData.roomId === data.roomId) {
					log.verbose("Got new room data to override");
					data = newData;
				}
			}
			log.verbose("Creation data:", data);
			log.verbose("Initial invites:", invites);
			update.name = data.name ? true : false;
			update.avatar = data.avatarUrl ? true : false;
			update.topic = data.topic ? true : false;
			// ooookay, we need to create this channel
			mxid = await client!.createRoom({
				visibility: "private",
				preset: "private_chat",
				power_level_content_override: {
					notifications: {
						room: 0,
					},
				},
				is_direct: data.isDirect,
				invite: invites,
			});
			await this.chanStore.setChanOp(mxid, await client!.getUserId());
			chan = this.chanStore.newData(mxid, data.roomId, data.puppetId);
			created = true;
		} else {
			update.name = data.name !== undefined && data.name !== chan.name;
			update.avatar = data.avatarUrl !== undefined && data.avatarUrl !== chan.avatarUrl;
			update.topic = data.topic !== undefined && data.topic !== chan.topic;
			mxid = chan.mxid;

			// set new client for potential updates
			const newClient = await this.getChanOp(mxid);
			if (newClient) {
				client = newClient;
			}
		}
		if (update.name) {
			log.verbose("Updating name");
			await client!.sendStateEvent(
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
				const avatarMxc = await client!.uploadContent(
					avatarData,
					Util.GetMimeType(avatarData), // TOOD: mimetype
				);
				chan.avatarMxc = avatarMxc;
			} else {
				// remove the avatar URL
				chan.avatarMxc = undefined;
			}
			await client!.sendStateEvent(
				mxid,
				"m.room.avatar",
				"",
				{ avatar_url: chan.avatarMxc },
			);
			chan.avatarUrl = data.avatarUrl;
		}
		if (update.topic) {
			log.verbose("updating topic");
			await client!.sendStateEvent(
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
		this.mxidLock.release(lockKey);

		return { mxid, created };
	}
}
