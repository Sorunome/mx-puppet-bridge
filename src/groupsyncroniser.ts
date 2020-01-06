import { PuppetBridge } from "./puppetbridge";
import { DbGroupStore, IGroupStoreEntry } from "./db/groupstore";
import { Log } from "./log";
import { Lock } from "./structures/lock";
import { Util } from "./util";

const log = new Log("GroupSync");

// tslint:disable-next-line:no-magic-numbers
const GROUP_LOOKUP_LOCK_TIMEOUT = 1000 * 60;
const GROUP_ID_LENGTH = 30;

export interface IRemoteGroup {
	groupId: string;
	puppetId: number;

	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
	name?: string | null;
	shortDescription?: string | null;
	longDescription?: string | null;
	roomIds?: string[] | null;
	externalUrl?: string | null;
}

export class GroupSyncroniser {
	private groupStore: DbGroupStore;
	private mxidLock: Lock<string>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.groupStore = this.bridge.groupStore;
		this.mxidLock = new Lock(GROUP_LOOKUP_LOCK_TIMEOUT);
	}

	public async maybeGet(data: IRemoteGroup): Promise<IGroupStoreEntry | null> {
		const lockKey = `${data.puppetId};${data.groupId}`;
		await this.mxidLock.wait(lockKey);
		return await this.groupStore.getByRemote(data.puppetId, data.groupId);
	}

	public async maybeGetMxid(data: IRemoteGroup): Promise<string | null> {
		const group = await this.maybeGet(data);
		if (!group) {
			return null;
		}
		return group.mxid;
	}

	public async getMxid(data: IRemoteGroup, doCreate: boolean = true): Promise<string> {
		const lockKey = `${data.puppetId};${data.groupId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		log.info(`Fetching mxid for groupId ${data.groupId} and puppetId ${data.puppetId}`);
		try {
			// groups are always handled by the AS bot
			const client = this.bridge.botIntent.underlyingClient;
			const clientUnstable = client.unstableApis;
			let group = await this.groupStore.getByRemote(data.puppetId, data.groupId);
			const update = {
				name: false,
				avatar: false,
				shortDescription: false,
				longDescription: false,
			};
			let mxid = "";
			let doUpdate = false;
			let created = false;
			let newRooms: string[] = [];
			const removedRooms: string[] = [];
			if (!group) {
				if (!doCreate) {
					this.mxidLock.release(lockKey);
					return "";
				}
				log.info("Group doesn't exist yet, creating entry...");
				doUpdate = true;
				created = true;
				// let's fetch the create data via hook
				if (this.bridge.hooks.createGroup) {
					log.verbose("Fetching new override data...");
					const newData = await this.bridge.hooks.createGroup(data);
					if (newData && newData.puppetId === data.puppetId && newData.groupId === data.groupId) {
						data = newData;
					} else {
						log.warn("Override data is malformed! Old data:", data, "New data:", newData);
					}
				}
				log.verbose("Creation data:", data);
				update.name = data.name ? true : false;
				update.avatar = data.avatarUrl ? true : false;
				update.shortDescription = data.shortDescription ? true : false;
				update.longDescription = data.longDescription ? true : false;
				if (data.roomIds) {
					newRooms = data.roomIds;
				}

				// now create the group
				while (mxid === "") {
					try {
						const localpart = this.makeRandomId(GROUP_ID_LENGTH);
						mxid = await clientUnstable.createGroup(localpart);
					} catch (err) {
						if (err.body.errcode === "M_UNKNOWN" && err.body.error.toLowerCase().includes("group already exists")) {
							mxid = "";
						} else {
							throw err;
						}
					}
				}
				// set it to invite only
				await clientUnstable.setGroupJoinPolicy(mxid, "invite");

				group = this.groupStore.newData(mxid, data.groupId, data.puppetId);
			} else {
				update.name = data.name !== undefined && data.name !== group.name;
				update.avatar = data.avatarUrl !== undefined && data.avatarUrl !== group.avatarUrl;
				update.shortDescription = data.shortDescription !== undefined && data.shortDescription !== group.shortDescription;
				update.longDescription = data.longDescription !== undefined && data.longDescription !== group.longDescription;
				if (data.roomIds) {
					for (const r of data.roomIds) {
						if (!group.roomIds.includes(r)) {
							// new room
							newRooms.push(r);
						}
					}
					for (const r of group.roomIds) {
						if (!data.roomIds.includes(r)) {
							// removed room
							removedRooms.push(r);
							break;
						}
					}
				}
				mxid = group.mxid;
			}

			const groupProfile = {
				name: group.name || "",
				avatar_url: group.avatarMxc || "",
				short_description: group.shortDescription || "",
				long_description: group.longDescription || "",
			};

			if (update.name) {
				doUpdate = true;
				groupProfile.name = data.name || "";
				group.name = data.name;
			}
			if (update.avatar || data.avatarBuffer) {
				log.verbose("Updating avatar");
				const { doUpdate: updateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(
					async (buffer: Buffer, mimetype?: string, filename?: string) => {
						return await this.bridge.uploadContent(client, buffer, mimetype, filename);
					}, data, group.avatarHash);
				if (updateAvatar) {
					doUpdate = true;
					group.avatarUrl = data.avatarUrl;
					group.avatarHash = hash;
					group.avatarMxc = mxcUrl;
					groupProfile.avatar_url = mxcUrl || "";
				}
			}
			if (update.shortDescription) {
				groupProfile.short_description = data.shortDescription || "";
				group.shortDescription = data.shortDescription;
			}
			if (update.longDescription) {
				groupProfile.long_description = data.longDescription || "";
				group.longDescription = data.longDescription;
			}

			if (data.roomIds && (newRooms.length > 0 || removedRooms.length > 0)) {
				group.roomIds = data.roomIds;
				doUpdate = true;
			}

			if (doUpdate) {
				log.verbose("Sending update to matrix server");
				await clientUnstable.setGroupProfile(mxid, groupProfile);
			}
			if (doUpdate || newRooms.length > 0 || removedRooms.length > 0) {
				log.verbose("Storing update to DB");
				await this.groupStore.set(group);
			}

			if (created) {
				// finally invite the puppet
				const puppetMxid = await this.bridge.provisioner.getMxid(data.puppetId);
				if (puppetMxid) {
					await clientUnstable.inviteUserToGroup(mxid, puppetMxid);
				}
			}

			this.mxidLock.release(lockKey);

			// update associated rooms only after lock is released
			if (newRooms.length > 0 || removedRooms.length > 0) {
				for (const roomId of newRooms) {
					const chanMxid = await this.bridge.chanSync.maybeGetMxid({
						puppetId: group.puppetId,
						roomId,
					});
					if (chanMxid) {
						try {
							await clientUnstable.addRoomToGroup(mxid, chanMxid, false);
						} catch (err) { }
					}
				}
				for (const roomId of removedRooms) {
					const chanMxid = await this.bridge.chanSync.maybeGetMxid({
						puppetId: group.puppetId,
						roomId,
					});
					if (chanMxid) {
						try {
							await clientUnstable.removeRoomFromGroup(mxid, chanMxid);
						} catch (err) { }
					}
				}
			}

			log.verbose("Returning mxid");
			return mxid;
		} catch (err) {
			log.error("Failed fetching mxid:", err);
			this.mxidLock.release(lockKey);
			throw err;
		}
	}

	public async addRoomToGroup(group: IRemoteGroup, roomId: string, recursionStop: boolean = false) {
		log.verbose(`Adding rooom ${roomId} to group ${group.groupId}`);
		// here we can't just invoke getMxid with the diff to add the room
		// as it might already be in the array but not actually part of the group
		const chanMxid = await this.bridge.chanSync.maybeGetMxid({
			puppetId: group.puppetId,
			roomId,
		});
		if (!chanMxid) {
			log.silly("room not found");
			return;
		}
		const mxid = await this.getMxid(group);
		const dbGroup = await this.maybeGet(group);
		if (dbGroup) {
			if (!dbGroup.roomIds.includes(roomId)) {
				dbGroup.roomIds.push(roomId);
			}
			await this.groupStore.set(dbGroup);
		}
		const clientUnstable = this.bridge.botIntent.underlyingClient.unstableApis;
		try {
			await clientUnstable.addRoomToGroup(mxid, chanMxid, false);
		} catch (err) { }
	}

	public async removeRoomFromGroup(group: IRemoteGroup, roomId: string) {
		log.info(`Removing room ${roomId} from group ${group.groupId}`);
		// as before, we don't invoke via getMxid as maybe the room is still
		// wrongfully in the group
		const chanMxid = await this.bridge.chanSync.maybeGetMxid({
			puppetId: group.puppetId,
			roomId,
		});
		if (!chanMxid) {
			return;
		}
		const dbGroup = await this.maybeGet(group);
		if (!dbGroup) {
			return;
		}
		group.roomIds = dbGroup.roomIds;
		const foundIndex = group.roomIds.indexOf(roomId);
		if (foundIndex === -1) {
			return;
		}
		group.roomIds.splice(foundIndex, 1);
		await this.groupStore.set(dbGroup);
		const clientUnstable = this.bridge.botIntent.underlyingClient.unstableApis;
		try {
			await clientUnstable.removeRoomFromGroup(dbGroup.mxid, chanMxid);
		} catch (err) { }
	}

	private makeRandomId(length: number): string {
		let result = "";
		// uppercase chars aren't allowed in MXIDs
		const chars = "abcdefghijklmnopqrstuvwxyz-_1234567890=";
		const charsLen = chars.length;
		for (let i = 0; i < length; i++) {
			result += chars.charAt(Math.floor(Math.random() * charsLen));
		}
		return result;
	}
}
