/*
Copyright 2020 mx-puppet-bridge
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { PuppetBridge } from "./puppetbridge";
import { IRemoteGroup, RemoteGroupResolvable, RemoteRoomResolvable } from "./interfaces";
import { DbGroupStore } from "./db/groupstore";
import { IGroupStoreEntry, IProfileDbEntry } from "./db/interfaces";
import { Log } from "./log";
import { Lock } from "./structures/lock";
import { Util } from "./util";
import { StringFormatter } from "./structures/stringformatter";

const log = new Log("GroupSync");

// tslint:disable-next-line:no-magic-numbers
const GROUP_LOOKUP_LOCK_TIMEOUT = 1000 * 60;
const GROUP_ID_LENGTH = 30;
const MATRIX_URL_SCHEME_MASK = "https://matrix.to/#/";

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
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(data.puppetId);
		const lockKey = `${dbPuppetId};${data.groupId}`;
		await this.mxidLock.wait(lockKey);
		return await this.groupStore.getByRemote(dbPuppetId, data.groupId);
	}

	public async maybeGetMxid(data: IRemoteGroup): Promise<string | null> {
		const group = await this.maybeGet(data);
		if (!group) {
			return null;
		}
		return group.mxid;
	}

	public async getMxid(data: IRemoteGroup, doCreate: boolean = true): Promise<string> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(data.puppetId);
		const lockKey = `${dbPuppetId};${data.groupId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		log.info(`Fetching mxid for groupId ${data.groupId} and puppetId ${dbPuppetId}`);
		try {
			// groups are always handled by the AS bot
			const client = this.bridge.botIntent.underlyingClient;
			const clientUnstable = client.unstableApis;
			let group = await this.groupStore.getByRemote(dbPuppetId, data.groupId);
			const update = {
				name: false,
				avatar: false,
				shortDescription: false,
				longDescription: false,
			};
			let mxid = "";
			let doUpdate = false;
			let oldProfile: IProfileDbEntry | null = null;
			let newRooms: string[] = [];
			const removedRooms: string[] = [];
			let invitePuppet = false;
			if (!group) {
				if (!doCreate) {
					this.mxidLock.release(lockKey);
					return "";
				}
				log.info("Group doesn't exist yet, creating entry...");
				const puppetData = await this.bridge.provisioner.get(data.puppetId);
				doUpdate = true;
				invitePuppet = Boolean(puppetData && puppetData.autoinvite);
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
				if (puppetData && puppetData.isPublic) {
					// set it to public
					await clientUnstable.setGroupJoinPolicy(mxid, "open");
				} else {
					// set it to invite only
					await clientUnstable.setGroupJoinPolicy(mxid, "invite");
				}

				group = this.groupStore.newData(mxid, data.groupId, dbPuppetId);
			} else {
				oldProfile = group;
				update.shortDescription = data.shortDescription !== undefined && data.shortDescription !== null
					&& data.shortDescription !== group.shortDescription;
				update.longDescription = data.longDescription !== undefined && data.longDescription !== null
					&& data.longDescription !== group.longDescription;
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

			const updateProfile = await Util.ProcessProfileUpdate(
				oldProfile, data, this.bridge.protocol.namePatterns.group,
				async (buffer: Buffer, mimetype?: string, filename?: string) => {
					return await this.bridge.uploadContent(client, buffer, mimetype, filename);
				},
			);
			group = Object.assign(group, updateProfile);

			const groupProfile = {
				name: group.name || "",
				avatar_url: group.avatarMxc || "",
				short_description: group.shortDescription || "",
				long_description: group.longDescription || "",
			};

			if (updateProfile.hasOwnProperty("name")) {
				doUpdate = true;
				groupProfile.name = group.name || "";
			}
			if (updateProfile.hasOwnProperty("avatarMxc")) {
				log.verbose("Updating avatar");
				doUpdate = true;
				groupProfile.avatar_url = group.avatarMxc || "";
			}
			if (update.shortDescription) {
				doUpdate = true;
				groupProfile.short_description = data.shortDescription || "";
				group.shortDescription = data.shortDescription;
			}
			if (update.longDescription) {
				doUpdate = true;
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

			if (invitePuppet) {
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
					const roomMxid = await this.bridge.roomSync.maybeGetMxid({
						puppetId: group.puppetId,
						roomId,
					});
					if (roomMxid) {
						try {
							await clientUnstable.addRoomToGroup(mxid, roomMxid, false);
						} catch (err) { }
					}
				}
				for (const roomId of removedRooms) {
					const roomMxid = await this.bridge.roomSync.maybeGetMxid({
						puppetId: group.puppetId,
						roomId,
					});
					if (roomMxid) {
						try {
							await clientUnstable.removeRoomFromGroup(mxid, roomMxid);
						} catch (err) { }
					}
				}
			}

			log.verbose("Returning mxid");
			return mxid;
		} catch (err) {
			log.error("Failed fetching mxid:", err.error || err.body || err);
			this.mxidLock.release(lockKey);
			throw err;
		}
	}

	public async addRoomToGroup(group: IRemoteGroup, roomId: string, recursionStop: boolean = false) {
		log.verbose(`Adding rooom ${roomId} to group ${group.groupId}`);
		// here we can't just invoke getMxid with the diff to add the room
		// as it might already be in the array but not actually part of the group
		const roomMxid = await this.bridge.roomSync.maybeGetMxid({
			puppetId: group.puppetId,
			roomId,
		});
		if (!roomMxid) {
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
			await clientUnstable.addRoomToGroup(mxid, roomMxid, false);
		} catch (err) { }
	}

	public async removeRoomFromGroup(group: IRemoteGroup, roomId: string) {
		log.info(`Removing room ${roomId} from group ${group.groupId}`);
		// as before, we don't invoke via getMxid as maybe the room is still
		// wrongfully in the group
		const roomMxid = await this.bridge.roomSync.maybeGetMxid({
			puppetId: group.puppetId,
			roomId,
		});
		if (!roomMxid) {
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
			await clientUnstable.removeRoomFromGroup(dbGroup.mxid, roomMxid);
		} catch (err) { }
	}

	public async getPartsFromMxid(mxid: string): Promise<IRemoteGroup | null> {
		const ret = await this.groupStore.getByMxid(mxid);
		if (!ret) {
			return null;
		}
		return {
			puppetId: ret.puppetId,
			groupId: ret.groupId,
		};
	}

	public async resolve(str: RemoteGroupResolvable): Promise<IRemoteGroup | null> {
		const remoteRoomToGroup = async (ident: RemoteRoomResolvable): Promise<IRemoteGroup | null> => {
			const parts = await this.bridge.roomSync.resolve(ident);
			if (!parts) {
				return null;
			}
			const room = await this.bridge.roomSync.maybeGet(parts);
			if (!room || !room.groupId) {
				return null;
			}
			return {
				puppetId: room.puppetId,
				groupId: room.groupId,
			};
		};
		if (!str) {
			return null;
		}
		if (typeof str !== "string") {
			if ((str as IRemoteGroup).groupId) {
				return str as IRemoteGroup;
			}
			return await remoteRoomToGroup(str as RemoteRoomResolvable);
		}
		str = str.trim();
		if (str.startsWith(MATRIX_URL_SCHEME_MASK)) {
			str = str.slice(MATRIX_URL_SCHEME_MASK.length);
		}
		switch (str[0]) {
			case "#":
			case "!":
			case "@":
				return await remoteRoomToGroup(str);
			case "+":
				return await this.getPartsFromMxid(str);
			default: {
				const parts = str.split(" ");
				const puppetId = Number(parts[0]);
				if (!isNaN(puppetId)) {
					return {
						puppetId,
						groupId: parts[1],
					};
				}
				return null;
			}
		}
		return null;
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
