import { PuppetBridge } from "./puppetbridge";
import { Util } from "./util";
import { Log } from "./log";
import { DbChanStore, IChanStoreEntry } from "./db/chanstore";
import { MatrixClient } from "matrix-bot-sdk";
import { Lock } from "./structures/lock";
import { Buffer } from "buffer";

const log = new Log("ChannelSync");

// tslint:disable-next-line:no-magic-numbers
const MXID_LOOKUP_LOCK_TIMEOUT = 1000 * 60;

export interface IRemoteChan {
	roomId: string;
	puppetId: number;

	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
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

	public async getRemoteHandler(mxid: string): Promise<IRemoteChan | null> {
		const chan = await this.chanStore.getByMxid(mxid);
		if (!chan) {
			return null;
		}
		return {
			roomId: chan.roomId,
			puppetId: chan.puppetId,
		} as IRemoteChan;
	}

	public async getChanOp(chan: string): Promise<MatrixClient|null> {
		const mxid = await this.chanStore.getChanOp(chan);
		if (!mxid) {
			return null;
		}
		if (!this.bridge.AS.isNamespacedUser(mxid)) {
			const token = await this.bridge.provisioner.getToken(mxid);
			if (!token) {
				return null;
			}
			return new MatrixClient(token.hsUrl, token.token);
		}
		return this.bridge.AS.getIntentForUserId(mxid).underlyingClient;
	}

	public async maybeGet(data: IRemoteChan): Promise<IChanStoreEntry | null> {
		const lockKey = `${data.puppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		return await this.chanStore.getByRemote(data.puppetId, data.roomId);
	}

	public async maybeGetMxid(data: IRemoteChan): Promise<string | null> {
		const chan = await this.maybeGet(data);
		if (!chan) {
			return null;
		}
		return chan.mxid;
	}

	public async getMxid(
		data: IRemoteChan,
		client?: MatrixClient,
		invites?: string[],
		doCreate: boolean = true,
	): Promise<{ mxid: string; created: boolean; }> {
		const lockKey = `${data.puppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${data.puppetId}`);
		if (!client) {
			client = this.bridge.botIntent.underlyingClient;
		}
		let chan = await this.chanStore.getByRemote(data.puppetId, data.roomId);
		log.silly(chan);
		const update = {
			name: false,
			avatar: false,
			topic: false,
		};
		let mxid = "";
		let doUpdate = false;
		let created = false;
		if (!chan) {
			if (!doCreate) {
				return {
					mxid: "",
					created: false,
				};
			}
			log.info("Channel doesn't exist yet, creating entry...");
			this.mxidLock.set(lockKey);
			doUpdate = true;
			// let's fetch the create data via hook
			if (this.bridge.hooks.createChan) {
				log.verbose("Fetching new override data...");
				const newData = await this.bridge.hooks.createChan(data.puppetId, data.roomId);
				if (newData && newData.puppetId === data.puppetId && newData.roomId === data.roomId) {
					data = newData;
				} else {
					log.warn("Override data is malformed! Old data:", data, "New data:", newData);
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
		if (update.avatar || data.avatarBuffer) {
			log.verbose("Updating avatar");
			const { doUpdate: updateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(client!, data, chan.avatarHash);
			if (updateAvatar) {
				update.avatar = true;
				chan.avatarUrl = data.avatarUrl;
				chan.avatarHash = hash;
				chan.avatarMxc = mxcUrl;
				await client!.sendStateEvent(
					mxid,
					"m.room.avatar",
					"",
					{ url: chan.avatarMxc },
				);
			}
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

	public async delete(data: IRemoteChan) {
		const chan = await this.maybeGet(data);
		if (!chan) {
			return;
		}
		await this.deleteEntries([ chan ]);
	}

	public async deleteForMxid(mxid: string) {
		const chan = await this.chanStore.getByMxid(mxid);
		if (!chan) {
			return; // nothing to do
		}
		await this.deleteEntries([ chan ]);
	}

	public async deleteForPuppet(puppetId: number) {
		const entries = await this.chanStore.getByPuppetId(puppetId);
		await this.deleteEntries(entries);
	}

	private async deleteEntries(entries: IChanStoreEntry[]) {
		log.info("Deleting entries", entries);
		for (const entry of entries) {
			// delete from DB (also OP store), cache and trigger ghosts to quit
			await this.chanStore.delete(entry);

			log.info("Removing bot client from room....");
			const botIntent = this.bridge.botIntent;
			const botRooms = await botIntent.getJoinedRooms();
			if (botRooms.includes(entry.mxid)) {
				try {
					await botIntent.leaveRoom(entry.mxid);
				} catch (err) {
					log.warn("Failed to make bot client leave", err);
				}
			}

			log.info("Removing ghosts from room....");
			const ghosts = await this.bridge.puppetStore.getGhostsInChan(entry.mxid);
			for (const ghost of ghosts) {
				const intent = await this.bridge.userSync.deleteForMxid(ghost);
				if (intent) {
					try {
						await intent.underlyingClient.leaveRoom(entry.mxid);
					} catch (err) {
						log.warn("Failed to trigger client leave room", err);
					}
				}
			}
			await this.bridge.puppetStore.emptyGhostsInChan(entry.mxid);
		}
	}
}
