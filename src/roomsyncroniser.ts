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
import { IRemoteRoom, RemoteRoomResolvable, IRemoteUser, RemoteUserResolvable, IRemoteEmote } from "./interfaces";
import { Util } from "./util";
import { Log } from "./log";
import { DbRoomStore } from "./db/roomstore";
import { IRoomStoreEntry } from "./db/interfaces";
import { MatrixClient } from "@sorunome/matrix-bot-sdk";
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
	avatar_url?: string;
	external_url?: string;
}

interface IBridgeInformation {
	bridgebot?: string;
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

	public async getRoomOp(room: string | IRemoteRoom): Promise<MatrixClient|null> {
		if (typeof room !== "string") {
			const roomId = await this.maybeGetMxid(room);
			if (!roomId) {
				return null;
			}
			room = roomId;
		}
		let mxid = await this.roomStore.getRoomOp(room);
		if (!mxid) {
			const ghosts = await this.bridge.puppetStore.getGhostsInRoom(room);
			if (ghosts[0] ) {
				mxid = ghosts[0];
			}
		}
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
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(data.puppetId);
		const lockKey = `${dbPuppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		return await this.roomStore.getByRemote(dbPuppetId, data.roomId);
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
	): Promise<{ mxid: string; created: boolean; }> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(data.puppetId);
		const lockKey = `${dbPuppetId};${data.roomId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		log.info(`Fetching mxid for roomId ${data.roomId} and puppetId ${dbPuppetId}`);
		try {
			if (!client) {
				client = this.bridge.botIntent.underlyingClient;
			}
			let room = await this.roomStore.getByRemote(dbPuppetId, data.roomId);
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
				const newData = await this.bridge.namespaceHandler.createRoom(data);
				if (newData) {
					data = newData;
				}
				const createInfo = await this.bridge.namespaceHandler.getRoomCreateInfo(data);
				if (!invites) {
					invites = new Set<string>();
				}
				for (const user of createInfo.invites) {
					invites.add(user);
				}
				let userId = await client.getUserId();
				if (!this.bridge.AS.isNamespacedUser(userId)) {
					// alright, let's only allow puppets to create rooms here
					let found = false;
					for (const invite of invites) {
						if (this.bridge.AS.isNamespacedUser(invite)) {
							client = this.bridge.AS.getIntentForUserId(invite).underlyingClient;
							found = true;
							break;
						}
					}
					if (!found) {
						client = this.bridge.botIntent.underlyingClient;
					}
					invites.add(userId);
					userId = await client.getUserId();
				}
				invites.delete(userId);
				// alright, we need to make sure that someone of our namespace is in the room
				// else messages won't relay correclty. Let's do that here.
				let haveNamespacedInvite = this.bridge.AS.isNamespacedUser(userId);
				if (!haveNamespacedInvite) {
					for (const user of invites) {
						if (this.bridge.AS.isNamespacedUser(user)) {
							haveNamespacedInvite = true;
							break;
						}
					}
				}
				if (!haveNamespacedInvite) {
					invites.add(this.bridge.botIntent.userId);
				}
				// now, we want the bridge bot to create stuff, if this isn't a direct room
				if (!data.isDirect) {
					invites.add(userId);
					invites.delete(this.bridge.botIntent.userId);
					client = this.bridge.botIntent.underlyingClient;
					userId = this.bridge.botIntent.userId;
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
					visibility: createInfo.public ? "public" : "private",
					preset: createInfo.public ? "public_chat" : "private_chat",
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
					const suffix = await this.bridge.namespaceHandler.getSuffix(dbPuppetId, data.roomId);
					createParams.room_alias_name = this.bridge.AS.getAliasLocalpartForSuffix(suffix);
					createParams.initial_state.push({
						type: "m.room.canonical_alias",
						content: {
							alias: null,
							alt_aliases: [this.bridge.AS.getAliasForSuffix(suffix)],
						},
					});
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
				room = this.roomStore.newData(mxid, data.roomId, dbPuppetId);
				room = Object.assign(room, updateProfile);
				if (data.topic) {
					room.topic = data.topic;
				}
				if (data.groupId && this.bridge.groupSyncEnabled) {
					room.groupId = data.groupId;
					addGroup = room.groupId;
				}
				room.isDirect = Boolean(data.isDirect);
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
				try {
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
					if (typeof data.isDirect === "boolean" && data.isDirect !== room.isDirect) {
						doUpdate = true;
						room.isDirect = data.isDirect;
					}
					if (data.groupId !== undefined && data.groupId !== null && data.groupId !== room.groupId
						&& this.bridge.groupSyncEnabled) {
						doUpdate = true;
						removeGroup = room.groupId;
						addGroup = data.groupId;
						room.groupId = data.groupId;
					}
				} catch (updateErr) {
					doUpdate = false;
					log.warn("Failed to update the room", updateErr.error || updateErr.body || updateErr);
				}
			}

			if (doUpdate) {
				log.verbose("Storing update to DB");
				await this.roomStore.set(room);
				log.verbose("Room info changed in getMxid, updating bridge info state event");
				// This might use getMxid itself, so do it in the background to avoid duplicate locks
				this.updateBridgeInformation(data).catch(err => log.error("Failed to update bridge info state event:", err));
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

			// upate emotes (in the background)
			if (data.emotes) {
				// tslint:disable-next-line no-floating-promises
				(async () => {
					try {
						if (!data.emotes) {
							return;
						}
						const realEmotes: IRemoteEmote[] = [];
						for (const e of data.emotes) {
							const emote = e as IRemoteEmote;
							if (!emote.hasOwnProperty("roomId")) {
								emote.roomId = data.roomId;
							}
							if (!emote.puppetId) {
								emote.puppetId = data.puppetId;
							}
							realEmotes.push(emote);
						}
						await this.bridge.emoteSync.setMultiple(realEmotes);
					} catch (err) {
						log.error("Error processing emote updates", err.error || err.body || err);
					}
				})();
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
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(roomData.puppetId);
		const lockKey = `${dbPuppetId};${roomData.roomId}`;
		await this.mxidLock.wait(lockKey);
		this.mxidLock.set(lockKey);
		const entry = this.roomStore.newData(mxid, roomData.roomId, dbPuppetId);
		await this.roomStore.set(entry);
		this.mxidLock.release(lockKey);
	}

	public async markAsDirect(room: IRemoteRoom, direct: boolean = false) {
		const data = await this.maybeGet(room);
		if (!data || data.isDirect === direct) {
			return; // nothing to mark as used
		}
		data.isDirect = direct;
		await this.roomStore.set(data);
	}

	public async markAsUsed(room: IRemoteRoom, used: boolean = true) {
		const data = await this.maybeGet(room);
		if (!data || data.isUsed === used) {
			return; // nothing to mark as used
		}
		data.isUsed = used;
		await this.roomStore.set(data);
	}

	public async updateBridgeInformation(data: IRemoteRoom) {
		log.info("Updating bridge information state event");
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
		const bridgebot = this.bridge.botIntent.userId;
		const creator = await this.bridge.provisioner.getMxid(data.puppetId);
		const protocol: ISingleBridgeInformation = {
			id: this.bridge.protocol.id,
			displayname: this.bridge.protocol.displayname,
		};
		if (this.bridge.config.bridge.avatarUrl) {
			protocol.avatar_url = this.bridge.config.bridge.avatarUrl;
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
			channel.avatar_url = room.avatarMxc;
		}
		if (room.externalUrl) {
			channel.external_url = room.externalUrl;
		}
		const content: IBridgeInformation = {
			bridgebot,
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
					network.avatar_url = group.avatarMxc;
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
		// TODO remove this once https://github.com/matrix-org/matrix-doc/pull/2346 is in spec
		await client.sendStateEvent(
			room.mxid,
			"uk.half-shot.bridge",
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
		const parts = this.bridge.namespaceHandler.fromSuffix(suffix);
		if (!parts) {
			return null;
		}
		return {
			puppetId: parts.puppetId,
			roomId: parts.id,
		};
	}

	public async addGhosts(room: IRemoteRoom) {
		log.info(`Got request to add ghosts to room puppetId=${room.puppetId} roomId=${room.roomId}`);
		const mxid = await this.maybeGetMxid(room);
		if (!mxid) {
			log.info("Room not found, returning...");
			return;
		}
		const roomUserIds = await this.bridge.namespaceHandler.getUserIdsInRoom(room);
		if (!roomUserIds) {
			log.info("No ghosts to add, returning...");
			return;
		}
		const puppetUserIds = await this.bridge.namespaceHandler.getRoomPuppetUserIds(room);
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
		for (const userId of puppetUserIds) {
			roomUserIds.delete(userId);
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
			await this.giveOp(client, roomMxid, newOp);
		}
		// and finally we passed all checks and can leave
		await intent.leaveRoom(roomMxid);
		await this.bridge.puppetStore.leaveGhostFromRoom(userMxid, roomMxid);
	}

	public async puppetToGlobalNamespace(puppetId: number) {
		if (puppetId === -1) {
			return;
		}
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		if (dbPuppetId !== -1) {
			return;
		}
		log.info(`Migrating ${puppetId} to global namespace...`);
		const entries = await this.roomStore.getByPuppetId(puppetId);
		for (const entry of entries) {
			const existingRoom = await this.maybeGet({
				roomId: entry.roomId,
				puppetId: -1,
			});
			const oldOpClient = await this.getRoomOp(entry.mxid);
			const client = oldOpClient || this.bridge.botIntent.underlyingClient;
			if (existingRoom) {
				// alright, easy for us, let's just...set a room upgrade
				log.verbose(`Room ${entry.roomId} already exists, tombstoneing...`);
				await client.sendStateEvent(entry.mxid, "m.room.tombstone", "", {
					body: "This room has been replaced",
					replacement_room: existingRoom.mxid,
				});
				await this.deleteEntries([ entry ], true);
				continue;
			}
			// okay, there is no existing room.....time to tediously update the database entry
			log.verbose(`Room ${entry.roomId} doesn't exist yet, migrating...`);
			// first do the alias
			const oldAlias = this.bridge.AS.getAliasForSuffix(`${puppetId}_${Util.str2mxid(entry.roomId)}`);
			const newAlias = this.bridge.AS.getAliasForSuffix(await this.bridge.namespaceHandler.getSuffix(-1, entry.roomId));
			try {
				const ret = await client.lookupRoomAlias(oldAlias);
				if (ret) {
					await client.deleteRoomAlias(oldAlias);
					await client.createRoomAlias(newAlias, entry.mxid);
					const prevCanonicalAlias = await client.getRoomStateEvent(entry.mxid, "m.room.canonical_alias", "");
					if (prevCanonicalAlias && prevCanonicalAlias.alias === oldAlias) {
						prevCanonicalAlias.alias = newAlias;
						await client.sendStateEvent(entry.mxid, "m.room.canonical_alias", "", prevCanonicalAlias);
					}
				}
			} catch (err) {
				log.verbose("No alias found, ignoring");
			}
			// now update the DB to reflect the puppetId correctly
			await this.roomStore.toGlobalNamespace(puppetId, entry.roomId);
			// alright, let's....attempt to migrate a single user that'll become OP
			if (oldOpClient) {
				log.verbose("Giving OP to new client...");
				let newGhost: string | null = null;
				if (this.bridge.hooks.getUserIdsInRoom) {
					const roomUserIds = await this.bridge.hooks.getUserIdsInRoom({
						puppetId,
						roomId: entry.roomId,
					});
					if (roomUserIds) {
						for (const userId of roomUserIds) {
							newGhost = userId;
							break;
						}
					}
				}
				let newOpIntent = this.bridge.botIntent;
				if (newGhost) {
					const suffix = await this.bridge.namespaceHandler.getSuffix(-1, newGhost);
					newOpIntent = this.bridge.AS.getIntentForSuffix(suffix);
					// we also want to populate avatar and stuffs
					await this.bridge.userSync.getClient({ puppetId: -1, userId: newGhost });
				}
				await newOpIntent.ensureRegisteredAndJoined(entry.mxid);
				await this.giveOp(oldOpClient, entry.mxid, newOpIntent.userId);
			}
			// okay, time to cycle out all the old ghosts
			log.verbose("Removing all old ghosts...");
			await this.removeGhostsFromRoom(entry.mxid, true, puppetId);
			// and finally fill in the new ghosts
			log.verbose("Adding new ghosts...");
			await this.addGhosts({
				puppetId: -1,
				roomId: entry.roomId,
			});
		}
	}

	public async rebridge(mxid: string, data: IRemoteRoom) {
		log.info(`Rebridging ${data.roomId} to ${mxid}...`);
		const oldMxid = await this.maybeGetMxid(data);
		if (oldMxid) {
			const oldOpClient = await this.getRoomOp(oldMxid);
			if (oldOpClient) {
				log.verbose("Tombstoning old room...");
				await oldOpClient.sendStateEvent(oldMxid, "m.room.tombstone", "", {
					body: "This room has been replaced",
					replacement_room: mxid,
				});
			}
			log.verbose("Deleting old room...");
			await this.delete(data, true);
		}
		await this.insert(mxid, data);
		// tslint:disable-next-line no-floating-promises
		this.addGhosts(data);
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
		if (puppetId === -1) {
			return;
		}
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		const entries = await this.roomStore.getByPuppetId(dbPuppetId);
		// now we have all the entires.....filter them out for if we are the sole admin!
		const deleteEntires: IRoomStoreEntry[] = [];
		for (const entry of entries) {
			if (await this.bridge.namespaceHandler.isSoleAdmin({
				puppetId: entry.puppetId,
				roomId: entry.roomId,
			}, puppetId)) {
				deleteEntires.push(entry);
			}
		}
		await this.deleteEntries(deleteEntires);
	}

	public async resolve(str: RemoteRoomResolvable, sender?: string): Promise<IRemoteRoom | null> {
		const remoteUserToGroup = async (ident: RemoteUserResolvable): Promise<IRemoteRoom | null> => {
			if (!this.bridge.hooks.getDmRoomId) {
				return null;
			}
			let parts = await this.bridge.userSync.resolve(ident);
			if (!parts) {
				return null;
			}
			if (sender) {
				parts = await this.bridge.namespaceHandler.getRemoteUser(parts, sender);
				if (!parts) {
					return null;
				}
			}
			const maybeRoomId = await this.bridge.hooks.getDmRoomId(parts);
			if (!maybeRoomId) {
				return null;
			}
			return {
				puppetId: parts.puppetId,
				roomId: maybeRoomId,
			};
		};
		if (!str) {
			return null;
		}
		if (typeof str !== "string") {
			if ((str as IRemoteRoom).roomId) {
				return str as IRemoteRoom;
			}
			if ((str as IRemoteUser).userId) {
				return await remoteUserToGroup(str as IRemoteUser);
			}
			return null;
		}
		str = str.trim();
		if (str.startsWith(MATRIX_URL_SCHEME_MASK)) {
			str = str.slice(MATRIX_URL_SCHEME_MASK.length);
		}
		switch (str[0]) {
			case "#": {
				const room = await this.getPartsFromMxid(str);
				if (room) {
					return room;
				}
				try {
					str = await this.bridge.botIntent.underlyingClient.resolveRoom(str);
				} catch (err) {
					return null;
				}
				// no break, as we roll over to the `!` case and re-try as that
			}
			case "!": {
				return await this.getPartsFromMxid(str);
			}
			case "@":
				return await remoteUserToGroup(str);
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

	private async giveOp(client: MatrixClient, roomMxid: string, newOp: string) {
		const oldOp = await client.getUserId();
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

	private async removeGhostsFromRoom(mxid: string, keepUsers: boolean, removePuppetId: number | null = null) {
		log.info("Removing ghosts from room....");
		const ghosts = await this.bridge.puppetStore.getGhostsInRoom(mxid);
		const promiseList: Promise<void>[] = [];
		let delay = this.bridge.config.limits.roomUserAutojoinDelay;
		for (const ghost of ghosts) {
			if (removePuppetId !== null) {
				const parts = this.bridge.userSync.getPartsFromMxid(ghost);
				if (!parts || parts.puppetId !== removePuppetId) {
					continue;
				}
			}
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
					const possibleAliases = new Set<string>();
					// let's first probe the canonical alias room state
					try {
						const canonicalAlias = await await opClient.getRoomStateEvent(entry.mxid, "m.room.canonical_alias", "");
						if (canonicalAlias.alias) {
							possibleAliases.add(canonicalAlias.alias);
						}
						if (canonicalAlias.alt_aliases) {
							for (const a of canonicalAlias.alt_aliases) {
								possibleAliases.add(a);
							}
						}
					} catch (err) {
						log.info("No m.room.canonical_alias set");
					}
					// now fetch all the aliases in the room
					try {
						const versions = await opClient.doRequest("GET", "/_matrix/client/versions");
						let path = "/_matrix/client/r0/rooms/";
						if (versions && versions.unstable_features && versions.unstable_features["org.matrix.msc2432"]) {
							path = "/_matrix/client/unstable/org.matrix.msc2432/rooms/";
						}
						path += encodeURIComponent(entry.mxid) + "/aliases";
						const aliases = await opClient.doRequest("GET", path);
						for (const a of aliases.aliases) {
							possibleAliases.add(a);
						}
					} catch (err) {
						log.info("New aliases enpoint doesn't exist yet");
					}
					// and now probe the old m.room.aliases state
					try {
						const aliases = await opClient.getRoomStateEvent(entry.mxid, "m.room.aliases", this.bridge.config.bridge.domain);
						for (const a of aliases.aliases) {
							possibleAliases.add(a);
						}
					} catch (err) {
						log.info("No m.room.aliases set");
					}
					// and now iterate over all the possible aliases and remove the ones that are ours
					for (const a of possibleAliases) {
						if (this.bridge.AS.isNamespacedAlias(a)) {
							try {
								await opClient.deleteRoomAlias(a);
							} catch (err) {
								log.warn(`Failed to remove alias ${a}`, err.error || err.body || err);
							}
						}
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
