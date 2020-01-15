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
	groupId?: string | null;
	isDirect?: boolean | null;
	externalUrl?: string | null;
}

interface ISingleBridgeInformation {
	id: string;
	displayname?: string;
	avatar?: string;
	external_url?: string;
}

interface IBridgeInformation {
	creator?: string;
	protocol: ISingleBridgeInformation;
	network?: ISingleBridgeInformation;
	channel: ISingleBridgeInformation;
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
			return await this.bridge.userSync.getClientFromTokenCallback(token);
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
		this.mxidLock.set(lockKey);
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${data.puppetId}`);
		try {
			if (!client) {
				client = this.bridge.botIntent.underlyingClient;
			}
			let chan = await this.chanStore.getByRemote(data.puppetId, data.roomId);
			let mxid = "";
			let doUpdate = false;
			let created = false;
			let removeGroup: string | undefined | null;
			let addGroup: string | undefined | null;
			if (!chan) {
				if (!doCreate) {
					this.mxidLock.release(lockKey);
					return {
						mxid: "",
						created: false,
					};
				}
				log.info("Channel doesn't exist yet, creating entry...");
				doUpdate = true;
				// let's fetch the create data via hook
				if (this.bridge.hooks.createChan) {
					log.verbose("Fetching new override data...");
					const newData = await this.bridge.hooks.createChan(data);
					if (newData && newData.puppetId === data.puppetId && newData.roomId === data.roomId) {
						data = newData;
					} else {
						log.warn("Override data is malformed! Old data:", data, "New data:", newData);
					}
				}
				log.verbose("Creation data:", data);
				log.verbose("Initial invites:", invites);
				// ooookay, we need to create this channel
				const createParams = {
					visibility: "private",
					preset: "private_chat",
					power_level_content_override: {
						notifications: {
							room: 0,
						},
					},
					is_direct: data.isDirect,
					invite: invites,
					initial_state: [],
				} as any;
				if (!data.isDirect) {
					// we also want to set an alias for later reference
					createParams.room_alias_name = this.bridge.AS.getAliasLocalpartForSuffix(
						`${data.puppetId}_${Util.str2mxid(data.roomId)}`);
				}
				if (data.name) {
					createParams.name = data.name;
				}
				let updateAvatar = false;
				let avatarHash = "";
				let avatarMxc = "";
				if (data.avatarUrl || data.avatarBuffer) {
					log.verbose("Uploading initial room avatar...");
					const { doUpdate: doUpdateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(
						async (buffer: Buffer, mimetype?: string, filename?: string) => {
							return await this.bridge.uploadContent(client!, buffer, mimetype, filename);
						}, data);
					updateAvatar = doUpdateAvatar;
					if (updateAvatar) {
						avatarHash = hash;
						avatarMxc = mxcUrl as string;
						createParams.initial_state.push({
							type: "m.room.avatar",
							content: { url: mxcUrl },
						});
					}
				}
				if (data.topic) {
					createParams.initial_state.push({
						type: "m.room.topic",
						content: { topic: data.topic },
					});
				}
				log.verbose("Creating room with create parameters", createParams);
				mxid = await client!.createRoom(createParams);
				await this.chanStore.setChanOp(mxid, await client!.getUserId());
				chan = this.chanStore.newData(mxid, data.roomId, data.puppetId);
				if (data.name) {
					chan.name = data.name;
				}
				if (updateAvatar) {
					chan.avatarUrl = data.avatarUrl;
					chan.avatarHash = avatarHash;
					chan.avatarMxc = avatarMxc;
				}
				if (data.topic) {
					chan.topic = data.topic;
				}
				if (data.groupId) {
					chan.groupId = data.groupId;
					addGroup = chan.groupId;
				}
				created = true;
			} else {
				mxid = chan.mxid;

				// set new client for potential updates
				const newClient = await this.getChanOp(mxid);
				if (newClient) {
					client = newClient;
				}
				if (data.name !== undefined && data.name !== null && data.name !== chan.name) {
					doUpdate = true;
					log.verbose("Updating name");
					await client!.sendStateEvent(
						mxid,
						"m.room.name",
						"",
						{ name: data.name },
					);
					chan.name = data.name;
				}
				if ((data.avatarUrl !== undefined && data.avatarUrl !== null && data.avatarUrl !== chan.avatarUrl)
					|| data.avatarBuffer) {
					log.verbose("Updating avatar");
					const { doUpdate: updateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(
						async (buffer: Buffer, mimetype?: string, filename?: string) => {
							return await this.bridge.uploadContent(client!, buffer, mimetype, filename);
						}, data, chan.avatarHash);
					if (updateAvatar) {
						doUpdate = true;
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
				if (data.topic !== undefined && data.topic !== null && data.topic !== chan.topic) {
					doUpdate = true;
					log.verbose("updating topic");
					await client!.sendStateEvent(
						mxid,
						"m.room.topic",
						"",
						{ topic: data.topic },
					);
					chan.topic = data.topic;
				}
				if (data.groupId !== undefined && data.groupId !== null && data.groupId !== chan.groupId) {
					doUpdate = true;
					removeGroup = chan.groupId;
					addGroup = data.groupId;
					chan.groupId = data.groupId;
				}
			}

			if (doUpdate) {
				log.verbose("Storing update to DB");
				await this.chanStore.set(chan);
			}

			this.mxidLock.release(lockKey);

			// update associated group only after releasing the lock
			if (this.bridge.groupSyncEnabled) {
				if (removeGroup) {
					await this.bridge.groupSync.removeRoomFromGroup({
						groupId: removeGroup,
						puppetId: chan.puppetId,
					}, chan.roomId);
				}
				if (addGroup) {
					await this.bridge.groupSync.addRoomToGroup({
						groupId: addGroup,
						puppetId: chan.puppetId,
					}, chan.roomId);
				}
			} else {
				log.verbose("Group sync is disabled");
			}

			log.verbose("Returning mxid");
			return { mxid, created };
		} catch (err) {
			log.error("Error fetching mxid:", err);
			this.mxidLock.release(lockKey);
			throw err;
		}
	}

	public async insert(mxid: string, roomData: IRemoteChan) {
		const lockKey = `${roomData.puppetId};${roomData.roomId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		const entry = {
			mxid,
			roomId: roomData.roomId,
			puppetId: roomData.puppetId,
		} as IChanStoreEntry;
		await this.chanStore.set(entry);
		this.mxidLock.release(lockKey);
	}

	public async updateBridgeInformation(data: IRemoteChan) {
		log.info("Updating bridge infromation state event");
		const chan = await this.maybeGet(data);
		if (!chan) {
			log.warn("Channel not found");
			return; // nothing to do
		}
		const client = await this.getChanOp(chan.mxid);
		if (!client) {
			log.warn("No OP in channel");
			return; // no op
		}
		const e = (s: string) => encodeURIComponent(Util.str2mxid(s));
		const stateKey = `de.sorunome.mx-puppet-bridge://${this.bridge.protocol.id}` +
			`${chan.groupId ? "/" + e(chan.groupId) : ""}/${e(chan.roomId)}`;
		const creator = await this.bridge.provisioner.getMxid(data.puppetId);
		const protocol: ISingleBridgeInformation = {
			id: this.bridge.protocol.id!,
			displayname: this.bridge.protocol.displayname,
		};
		if (this.bridge.config.bridge.avatarUrl) {
			protocol.avatar = this.bridge.config.bridge.avatarUrl;
		}
		if (this.bridge.protocol.externalUrl) {
			protocol.external_url = this.bridge.protocol.externalUrl;
		}
		const channel: ISingleBridgeInformation = {
			id: Util.str2mxid(chan.roomId),
		};
		if (chan.name) {
			channel.displayname = chan.name;
		}
		if (chan.avatarMxc) {
			channel.avatar = chan.avatarMxc;
		}
		if (chan.externalUrl) {
			channel.external_url = chan.externalUrl;
		}
		const content: IBridgeInformation = {
			creator,
			protocol,
			channel,
		};
		if (chan.groupId && this.bridge.groupSyncEnabled) {
			const group = await this.bridge.groupSync.maybeGet({
				groupId: chan.groupId,
				puppetId: chan.puppetId,
			});
			if (group) {
				const network: ISingleBridgeInformation = {
					id: group.groupId,
				};
				if (group.name) {
					network.displayname = group.name;
				}
				if (group.avatarMxc) {
					network.avatar = group.avatarMxc;
				}
				if (group.externalUrl) {
					network.external_url = group.externalUrl;
				}
				content.network = network;
			}
		}
		// finally set the state event
		log.verbose("sending state event", content, "with state key", stateKey);
		await client.sendStateEvent(
			chan.mxid,
			"m.bridge",
			stateKey,
			content,
		);
	}

	public getPartsFromMxid(mxid: string): IRemoteChan | null {
		const suffix = this.bridge.AS.getSuffixForAlias(mxid);
		if (!suffix) {
			return null;
		}
		const MXID_MATCH_PUPPET_ID = 1;
		const MXID_MATCH_ROOM_ID = 2;
		const matches = suffix.match(/^(\d+)_(.*)/);
		if (!matches) {
			return null;
		}
		const puppetId = Number(matches[MXID_MATCH_PUPPET_ID]);
		const roomId = Util.mxid2str(matches[MXID_MATCH_ROOM_ID]);
		if (isNaN(puppetId)) {
			return null;
		}
		return {
			puppetId,
			roomId,
		};
	}

	public async maybeLeaveGhost(chanMxid: string, userMxid: string) {
		log.info(`Maybe leaving ghost ${userMxid} from ${chanMxid}`);
		const ghosts = await this.bridge.puppetStore.getGhostsInChan(chanMxid);
		if (!ghosts.includes(userMxid)) {
			log.verbose("Ghost not in room!");
			return; // not in chan, nothing to do
		}
		if (ghosts.length === 1) {
			log.verbose("Ghost is the only one in the room!");
			return; // we are the last ghost in the chan, we can't leave
		}
		const intent = this.bridge.AS.getIntentForUserId(userMxid);
		const client = intent.underlyingClient;
		const oldOp = await this.chanStore.getChanOp(chanMxid);
		if (oldOp === userMxid) {
			// we need to get a new OP!
			log.verbose("We are the OP in the room, we need to pass on OP");
			const newOp = ghosts.find((element: string) => element !== userMxid);
			if (!newOp) {
				log.verbose("Noone to pass OP to!");
				return; // we can't make a new OP, sorry
			}
			log.verbose(`Giving OP to ${newOp}...`);
			try {
				// give the user OP
				const powerLevels = await client.getRoomStateEvent(
					chanMxid, "m.room.power_levels", "",
				);
				powerLevels.users[newOp] = powerLevels.users[oldOp];
				await client.sendStateEvent(
					chanMxid, "m.room.power_levels", "", powerLevels,
				);
				await this.chanStore.setChanOp(chanMxid, newOp);
			} catch (err) {
				log.error("Couldn't set new chan OP", err);
				return;
			}
		}
		// and finally we passed all checks and can leave
		await intent.leaveRoom(chanMxid);
		await this.bridge.puppetStore.leaveGhostFromChan(userMxid, chanMxid);
	}

	public async delete(data: IRemoteChan, keepUsers: boolean = false) {
		const chan = await this.maybeGet(data);
		if (!chan) {
			return;
		}
		await this.deleteEntries([ chan ], keepUsers);
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

	private async deleteEntries(entries: IChanStoreEntry[], keepUsers: boolean = false) {
		log.info("Deleting entries", entries);
		for (const entry of entries) {
			// first we clean up the room
			const opClient = await this.getChanOp(entry.mxid);
			if (opClient) {
				// we try...catch this as we *really* want to get to the DB deleting
				try {
					log.info("Removing old aliases from room...");
					// first remove the canonical alias
					await opClient.sendStateEvent(entry.mxid, "m.room.canonical_alias", "", {});
					// next fetch all aliases and remove the ones we can
					try {
						const aliases = await opClient.getRoomStateEvent(entry.mxid, "m.room.aliases", this.bridge.config.bridge.domain);
						for (const alias of aliases.aliases) {
							await opClient.deleteRoomAlias(alias);
						}
					} catch (err) {
						log.info("No aliases set");
					}
				} catch (err) {
					log.error("Error removing old aliases", err);
				}
			}

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
				if (!keepUsers) {
					await this.bridge.userSync.deleteForMxid(ghost);
				}
				const intent = this.bridge.AS.getIntentForUserId(ghost);
				if (intent) {
					try {
						await intent.leaveRoom(entry.mxid);
					} catch (err) {
						log.warn("Failed to trigger client leave room", err);
					}
				}
			}
			await this.bridge.puppetStore.emptyGhostsInChan(entry.mxid);
		}
	}
}
