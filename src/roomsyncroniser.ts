/*
Copyright 2019, 2020 mx-puppet-bridge
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
import { IRemoteRoom, RemoteRoomResolvable, IRemoteUser } from "./interfaces";
import { Util } from "./util";
import { Log } from "./log";
import { DbRoomStore } from "./db/roomstore";
import { IRoomStoreEntry } from "./db/interfaces";
import { MatrixClient } from "matrix-bot-sdk";
import { Lock } from "./structures/lock";
import { Buffer } from "buffer";
import { StringFormatter } from "./structures/stringformatter";

const log = new Log("RoomSync");

// tslint:disable-next-line:no-magic-numbers
const MXID_LOOKUP_LOCK_TIMEOUT = 1000 * 60;
const MATRIX_URL_SCHEME_MASK = "https://matrix.to/#/";

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

export class RoomSyncroniser {
	private roomStore: DbRoomStore;
	private mxidLock: Lock<string>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.roomStore = this.bridge.roomStore;
		this.mxidLock = new Lock(MXID_LOOKUP_LOCK_TIMEOUT);
	}

	public async getRoomOp(room: string): Promise<MatrixClient|null> {
		const mxid = await this.roomStore.getRoomOp(room);
		if (!mxid) {
			return null;
		}
		if (!this.bridge.AS.isNamespacedUser(mxid)) {
			const token = await this.bridge.provisioner.getToken(mxid);
			return await this.bridge.userSync.getClientFromTokenCallback(token);
		}
		return this.bridge.AS.getIntentForUserId(mxid).underlyingClient;
	}

	public async maybeGet(data: IRemoteRoom): Promise<IRoomStoreEntry | null> {
		const lockKey = `${data.puppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		return await this.roomStore.getByRemote(data.puppetId, data.roomId);
	}

	public async maybeGetMxid(data: IRemoteRoom): Promise<string | null> {
		const room = await this.maybeGet(data);
		if (!room) {
			return null;
		}
		return room.mxid;
	}

	public async getMxid(
		data: IRemoteRoom,
		client?: MatrixClient,
		invites?: Set<string>,
		doCreate: boolean = true,
		isPublic: boolean = false,
	): Promise<{ mxid: string; created: boolean; }> {
		const lockKey = `${data.puppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${data.puppetId}`);
		try {
			if (!client) {
				client = this.bridge.botIntent.underlyingClient;
			}
			let room = await this.roomStore.getByRemote(data.puppetId, data.roomId);
			let mxid = "";
			let doUpdate = false;
			let created = false;
			let removeGroup: string | undefined | null;
			let addGroup: string | undefined | null;
			if (!room) {
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
				if (this.bridge.hooks.createRoom) {
					log.verbose("Fetching new override data...");
					const newData = await this.bridge.hooks.createRoom(data);
					if (newData && newData.puppetId === data.puppetId && newData.roomId === data.roomId) {
						data = newData;
					} else {
						log.warn("Override data is malformed! Old data:", data, "New data:", newData);
					}
				}
				const updateProfile = await Util.ProcessProfileUpdate(
					null, data, this.bridge.protocol.namePatterns.room,
					async (buffer: Buffer, mimetype?: string, filename?: string) => {
						return await this.bridge.uploadContent(client!, buffer, mimetype, filename);
					},
				);
				log.verbose("Creation data:", data);
				log.verbose("Initial invites:", invites);
				// ooookay, we need to create this room
				const createParams = {
					visibility: isPublic ? "public" : "private",
					preset: isPublic ? "public_chat" : "private_chat",
					power_level_content_override: {
						notifications: {
							room: 0,
						},
						events: {
							"im.vector.user_status": 0,
						},
					},
					is_direct: data.isDirect,
					invite: invites ? Array.from(invites) : null,
					initial_state: [],
				} as any; // tslint:disable-line no-any
				if (!data.isDirect) {
					// we also want to set an alias for later reference
					createParams.room_alias_name = this.bridge.AS.getAliasLocalpartForSuffix(
						`${data.puppetId}_${Util.str2mxid(data.roomId)}`);
				}
				if (updateProfile.hasOwnProperty("name")) {
					createParams.name = updateProfile.name;
				}
				if (updateProfile.hasOwnProperty("avatarMxc")) {
					createParams.initial_state.push({
						type: "m.room.avatar",
						content: { url: updateProfile.avatarMxc },
					});
				}
				if (data.topic) {
					createParams.initial_state.push({
						type: "m.room.topic",
						content: { topic: data.topic },
					});
				}
				log.verbose("Creating room with create parameters", createParams);
				mxid = await client!.createRoom(createParams);
				await this.roomStore.setRoomOp(mxid, await client!.getUserId());
				room = this.roomStore.newData(mxid, data.roomId, data.puppetId);
				room = Object.assign(room, updateProfile);
				if (data.topic) {
					room.topic = data.topic;
				}
				if (data.groupId) {
					room.groupId = data.groupId;
					addGroup = room.groupId;
				}
				created = true;
			} else {
				mxid = room.mxid;

				// set new client for potential updates
				const newClient = await this.getRoomOp(mxid);
				if (newClient) {
					client = newClient;
				}
				const updateProfile = await Util.ProcessProfileUpdate(
					room, data, this.bridge.protocol.namePatterns.room,
					async (buffer: Buffer, mimetype?: string, filename?: string) => {
						return await this.bridge.uploadContent(client!, buffer, mimetype, filename);
					},
				);
				room = Object.assign(room, updateProfile);
				if (updateProfile.hasOwnProperty("name")) {
					doUpdate = true;
					log.verbose("Updating name");
					await client!.sendStateEvent(
						mxid,
						"m.room.name",
						"",
						{ name: room.name },
					);
				}
				if (updateProfile.hasOwnProperty("avatarMxc")) {
					doUpdate = true;
					log.verbose("Updating avatar");
					await client!.sendStateEvent(
						mxid,
						"m.room.avatar",
						"",
						{ url: room.avatarMxc },
					);
				}
				if (data.topic !== undefined && data.topic !== null && data.topic !== room.topic) {
					doUpdate = true;
					log.verbose("updating topic");
					await client!.sendStateEvent(
						mxid,
						"m.room.topic",
						"",
						{ topic: data.topic },
					);
					room.topic = data.topic;
				}
				if (data.groupId !== undefined && data.groupId !== null && data.groupId !== room.groupId) {
					doUpdate = true;
					removeGroup = room.groupId;
					addGroup = data.groupId;
					room.groupId = data.groupId;
				}
			}

			if (doUpdate) {
				log.verbose("Storing update to DB");
				await this.roomStore.set(room);
			}

			this.mxidLock.release(lockKey);

			// update associated group only after releasing the lock
			if (this.bridge.groupSyncEnabled) {
				if (removeGroup) {
					await this.bridge.groupSync.removeRoomFromGroup({
						groupId: removeGroup,
						puppetId: room.puppetId,
					}, room.roomId);
				}
				if (addGroup) {
					await this.bridge.groupSync.addRoomToGroup({
						groupId: addGroup,
						puppetId: room.puppetId,
					}, room.roomId);
				}
			} else {
				log.verbose("Group sync is disabled");
			}

			log.verbose("Returning mxid");
			return { mxid, created };
		} catch (err) {
			log.error("Error fetching mxid:", err.error || err.body || err);
			this.mxidLock.release(lockKey);
			throw err;
		}
	}

	public async insert(mxid: string, roomData: IRemoteRoom) {
		const lockKey = `${roomData.puppetId};${roomData.roomId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		const entry: IRoomStoreEntry = {
			mxid,
			roomId: roomData.roomId,
			puppetId: roomData.puppetId,
		};
		await this.roomStore.set(entry);
		this.mxidLock.release(lockKey);
	}

	public async updateBridgeInformation(data: IRemoteRoom) {
		log.info("Updating bridge infromation state event");
		const room = await this.maybeGet(data);
		if (!room) {
			log.warn("Room not found");
			return; // nothing to do
		}
		const client = await this.getRoomOp(room.mxid);
		if (!client) {
			log.warn("No OP in room");
			return; // no op
		}
		const e = (s: string) => encodeURIComponent(Util.str2mxid(s));
		const stateKey = `de.sorunome.mx-puppet-bridge://${this.bridge.protocol.id}` +
			`${room.groupId ? "/" + e(room.groupId) : ""}/${e(room.roomId)}`;
		const creator = await this.bridge.provisioner.getMxid(data.puppetId);
		const protocol: ISingleBridgeInformation = {
			id: this.bridge.protocol.id,
			displayname: this.bridge.protocol.displayname,
		};
		if (this.bridge.config.bridge.avatarUrl) {
			protocol.avatar = this.bridge.config.bridge.avatarUrl;
		}
		if (this.bridge.protocol.externalUrl) {
			protocol.external_url = this.bridge.protocol.externalUrl;
		}
		const channel: ISingleBridgeInformation = {
			id: Util.str2mxid(room.roomId),
		};
		if (room.name) {
			channel.displayname = room.name;
		}
		if (room.avatarMxc) {
			channel.avatar = room.avatarMxc;
		}
		if (room.externalUrl) {
			channel.external_url = room.externalUrl;
		}
		const content: IBridgeInformation = {
			creator,
			protocol,
			channel,
		};
		if (room.groupId && this.bridge.groupSyncEnabled) {
			const group = await this.bridge.groupSync.maybeGet({
				groupId: room.groupId,
				puppetId: room.puppetId,
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
			room.mxid,
			"m.bridge",
			stateKey,
			content,
		);
	}

	public async getPartsFromMxid(mxid: string): Promise<IRemoteRoom | null> {
		if (mxid[0] === "!") {
			const room = await this.roomStore.getByMxid(mxid);
			if (!room) {
				return null;
			}
			return {
				roomId: room.roomId,
				puppetId: room.puppetId,
			};
		}
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

	public async addGhosts(room: IRemoteRoom) {
		if (!this.bridge.hooks.getUserIdsInRoom) {
			// alright, we don't have this feature
			return;
		}
		log.info(`Got request to add ghosts to room puppetId=${room.puppetId} roomId=${room.roomId}`);
		const mxid = await this.maybeGetMxid(room);
		if (!mxid) {
			log.info("Room not found, returning...");
			return;
		}
		const roomUserIds = await this.bridge.hooks.getUserIdsInRoom(room);
		if (!roomUserIds) {
			log.info("No ghosts to add, returning...");
			return;
		}
		const puppetData = await this.bridge.provisioner.get(room.puppetId);
		if (!puppetData) {
			log.error("puppetData wasn't found, THIS SHOULD NEVER HAPPEN!");
			return;
		}
		const maxAutojoinUsers = this.bridge.config.limits.maxAutojoinUsers;
		if (maxAutojoinUsers !== -1) {
			// alright, let's make sure that we do not have too many ghosts to autojoin
			let i = 0;
			roomUserIds.forEach((userId: string) => {
				if (i < maxAutojoinUsers) {
					i++;
				} else {
					roomUserIds.delete(userId);
				}
			});
		}
		// cleanup
		if (puppetData.userId) {
			roomUserIds.delete(puppetData.userId);
		}

		// and now iterate over and do all the joins!
		log.info(`Joining ${roomUserIds.size} ghosts...`);
		const promiseList: Promise<void>[] = [];
		let delay = this.bridge.config.limits.roomUserAutojoinDelay;
		for (const userId of roomUserIds) {
			promiseList.push((async () => {
				await Util.sleep(delay);
				log.verbose(`Joining ${userId} to room puppetId=${room.puppetId} roomId=${room.roomId}`);
				const client = await this.bridge.userSync.getClient({
					puppetId: room.puppetId,
					userId,
				});
				const intent = this.bridge.AS.getIntentForUserId(await client.getUserId());
				await intent.ensureRegisteredAndJoined(mxid);
			})());
			delay += this.bridge.config.limits.roomUserAutojoinDelay;
		}
		await Promise.all(promiseList);
	}

	public async maybeLeaveGhost(roomMxid: string, userMxid: string) {
		log.info(`Maybe leaving ghost ${userMxid} from ${roomMxid}`);
		const ghosts = await this.bridge.puppetStore.getGhostsInRoom(roomMxid);
		if (!ghosts.includes(userMxid)) {
			log.verbose("Ghost not in room!");
			return; // not in room, nothing to do
		}
		if (ghosts.length === 1) {
			log.verbose("Ghost is the only one in the room!");
			return; // we are the last ghost in the room, we can't leave
		}
		const intent = this.bridge.AS.getIntentForUserId(userMxid);
		const client = intent.underlyingClient;
		const oldOp = await this.roomStore.getRoomOp(roomMxid);
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
					roomMxid, "m.room.power_levels", "",
				);
				powerLevels.users[newOp] = powerLevels.users[oldOp];
				await client.sendStateEvent(
					roomMxid, "m.room.power_levels", "", powerLevels,
				);
				await this.roomStore.setRoomOp(roomMxid, newOp);
			} catch (err) {
				log.error("Couldn't set new room OP", err.error || err.body || err);
				return;
			}
		}
		// and finally we passed all checks and can leave
		await intent.leaveRoom(roomMxid);
		await this.bridge.puppetStore.leaveGhostFromRoom(userMxid, roomMxid);
	}

	public async delete(data: IRemoteRoom, keepUsers: boolean = false) {
		const room = await this.maybeGet(data);
		if (!room) {
			return;
		}
		await this.deleteEntries([ room ], keepUsers);
	}

	public async deleteForMxid(mxid: string) {
		const room = await this.roomStore.getByMxid(mxid);
		if (!room) {
			return; // nothing to do
		}
		await this.deleteEntries([ room ]);
	}

	public async deleteForPuppet(puppetId: number) {
		const entries = await this.roomStore.getByPuppetId(puppetId);
		await this.deleteEntries(entries);
	}

	public async resolve(str: RemoteRoomResolvable): Promise<IRemoteRoom | null> {
		if (typeof str !== "string") {
			if ((str as IRemoteRoom).roomId) {
				return str as IRemoteRoom;
			}
			if ((str as IRemoteUser).userId) {
				if (!this.bridge.hooks.getDmRoomId) {
					return null;
				}
				const maybeRoomId = await this.bridge.hooks.getDmRoomId(str as IRemoteUser);
				if (!maybeRoomId) {
					return null;
				}
				return {
					puppetId: (str as IRemoteUser).puppetId,
					roomId: maybeRoomId,
				};
			}
			return null;
		}
		if (str.startsWith(MATRIX_URL_SCHEME_MASK)) {
			str = str.slice(MATRIX_URL_SCHEME_MASK.length);
		}
		switch (str[0]) {
			case "#": {
				const room = await this.getPartsFromMxid(str);
				if (room) {
					return room;
				}
				// no break, as we roll over to the `!` case and re-try as that
			}
			case "!": {
				try {
					const roomMxid = await this.bridge.botIntent.underlyingClient.resolveRoom(str);
					return await this.getPartsFromMxid(roomMxid);
				} catch (err) {
					return null;
				}
			}
			case "@": {
				if (!this.bridge.AS.isNamespacedUser(str) || !this.bridge.hooks.getDmRoomId) {
					return null;
				}
				const userParts = this.bridge.userSync.getPartsFromMxid(str);
				if (!userParts) {
					return null;
				}
				const maybeRoomId = await this.bridge.hooks.getDmRoomId(userParts);
				if (!maybeRoomId) {
					return null;
				}
				return {
					puppetId: userParts.puppetId,
					roomId: maybeRoomId,
				};
			}
			default: {
				const parts = str.split(" ");
				const puppetId = Number(parts[0]);
				if (!isNaN(puppetId)) {
					return {
						puppetId,
						roomId: parts[1],
					};
				}
				return null;
			}
		}
	}

	private async removeGhostsFromRoom(mxid: string, keepUsers: boolean) {
		log.info("Removing ghosts from room....");
		const ghosts = await this.bridge.puppetStore.getGhostsInRoom(mxid);
		const promiseList: Promise<void>[] = [];
		let delay = this.bridge.config.limits.roomUserAutojoinDelay;
		for (const ghost of ghosts) {
			promiseList.push((async () => {
				await Util.sleep(delay);
				log.verbose(`Removing ghost ${ghost} from room ${mxid}`);
				if (!keepUsers) {
					await this.bridge.userSync.deleteForMxid(ghost);
				}
				const intent = this.bridge.AS.getIntentForUserId(ghost);
				if (intent) {
					try {
						await intent.leaveRoom(mxid);
					} catch (err) {
						log.warn("Failed to trigger client leave room", err.error || err.body || err);
					}
				}
			})());
			delay += this.bridge.config.limits.roomUserAutojoinDelay;
		}
		await Promise.all(promiseList);
		await this.bridge.puppetStore.emptyGhostsInRoom(mxid);
	}

	private async deleteEntries(entries: IRoomStoreEntry[], keepUsers: boolean = false) {
		log.info("Deleting entries", entries);
		for (const entry of entries) {
			// first we clean up the room
			const opClient = await this.getRoomOp(entry.mxid);
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
							if (this.bridge.AS.isNamespacedAlias(alias)) {
								await opClient.deleteRoomAlias(alias);
							}
						}
					} catch (err) {
						log.info("No aliases set");
					}
				} catch (err) {
					log.error("Error removing old aliases", err.error || err.body || err);
				}
			}

			// delete from DB (also OP store), cache and trigger ghosts to quit
			await this.roomStore.delete(entry);

			log.info("Removing bot client from room....");
			const botIntent = this.bridge.botIntent;
			const botRooms = await botIntent.getJoinedRooms();
			if (botRooms.includes(entry.mxid)) {
				try {
					await botIntent.leaveRoom(entry.mxid);
				} catch (err) {
					log.warn("Failed to make bot client leave", err.error || err.body || err);
				}
			}

			// tslint:disable-next-line no-floating-promises
			this.removeGhostsFromRoom(entry.mxid, keepUsers);
		}
	}
}
