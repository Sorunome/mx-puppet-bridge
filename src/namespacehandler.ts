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

import { Log } from "./log";
import { Util } from "./util";
import { PuppetBridge } from "./puppetbridge";
import { IRemoteUser, IRemoteRoom, IRemoteGroup, IReceiveParams } from "./interfaces";

export interface IPuppetCreateInfo {
	public: boolean;
	invites: Set<string>;
}

const log = new Log("NamespaceHandler");

export class NamespaceHandler {
	private enabled: boolean;
	private usersInRoom: Map<string, Set<string>>;
	private puppetsForUser: Map<string, Set<number>>;
	private puppetsForRoom: Map<string, Set<number>>;
	private puppetsForGroup: Map<string, Set<number>>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.enabled = Boolean(this.bridge.protocol.features.globalNamespace);
		this.usersInRoom = new Map();
		this.puppetsForUser = new Map();
		this.puppetsForRoom = new Map();
		this.puppetsForGroup = new Map();
	}

	public async getSuffix(puppetId: number, id: string): Promise<string> {
		if (puppetId === -1) {
			if (!this.enabled) {
				throw new Error("Global namespace not enabled");
			}
			return `_${Util.str2mxid(id)}`;
		}
		if (this.enabled) {
			// maybe this is in a global namespace
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (!puppetData) {
				throw new Error("Puppet not found");
			}
			if (puppetData.isGlobalNamespace) {
				return `_${Util.str2mxid(id)}`;
			}
		}
		return `${puppetId}_${Util.str2mxid(id)}`;
	}

	public fromSuffix(suffix: string): null | { puppetId: number; id: string } {
		if (suffix[0] === "_") {
			if (!this.enabled) {
				return null;
			}
			return {
				puppetId: -1,
				id: Util.mxid2str(suffix.substr(1)),
			};
		}
		const SUFFIX_MATCH_PUPPET_ID = 1;
		const SUFFIX_MATCH_ID = 2;
		const matches = suffix.match(/^(\d+)_(.*)/);
		if (!matches) {
			return null;
		}
		const puppetId = Number(matches[SUFFIX_MATCH_PUPPET_ID]);
		const id = Util.mxid2str(matches[SUFFIX_MATCH_ID]);
		if (isNaN(puppetId)) {
			return null;
		}
		return {
			puppetId,
			id,
		};
	}

	public async canSee(roomParts: IRemoteRoom, sender: string): Promise<boolean> {
		const room = await this.bridge.roomSync.maybeGet(roomParts);
		if (!room) {
			return false;
		}
		if (room.puppetId !== -1) {
			const puppetData = await this.bridge.provisioner.get(room.puppetId);
			if (puppetData) {
				if (!puppetData.isGlobalNamespace) {
					return (puppetData.type === "puppet" && puppetData.puppetMxid === sender)
						|| (puppetData.type === "relay" && this.bridge.provisioner.canRelay(sender));
				}
				if (!this.enabled) {
					return false;
				}
			} else {
				return false;
			}
		}
		if (!this.puppetsForRoom.has(room.roomId) || true) {
			await this.populatePuppetsForRoom(room.roomId);
		}
		const puppetIds = this.puppetsForRoom.get(room.roomId);
		if (!puppetIds) {
			return false;
		}
		for (const puppetId of puppetIds) {
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (puppetData && ((puppetData.type === "puppet" && puppetData.puppetMxid === sender)
				|| (puppetData.type === "relay" && this.bridge.provisioner.canRelay(sender)))) {
				return true;
			}
		}
		return false;
	}

	public async isAdmin(roomParts: IRemoteRoom, sender: string): Promise<boolean> {
		const room = await this.bridge.roomSync.maybeGet(roomParts);
		if (!room) {
			return false;
		}
		if (room.puppetId !== -1) {
			const puppetData = await this.bridge.provisioner.get(room.puppetId);
			if (puppetData) {
				if (!puppetData.isGlobalNamespace) {
					return puppetData.puppetMxid === sender;
				}
				if (!this.enabled) {
					return false;
				}
			} else {
				return false;
			}
		}
		if (!this.enabled) {
			return false;
		}
		if (!this.puppetsForRoom.has(room.roomId) || true) {
			await this.populatePuppetsForRoom(room.roomId);
		}
		const puppetIds = this.puppetsForRoom.get(room.roomId);
		if (!puppetIds || puppetIds.size !== 1) {
			return false;
		}
		let thePuppet = -1;
		for (const pid of puppetIds) {
			thePuppet = pid;
			break;
		}
		{
			const puppetData = await this.bridge.provisioner.get(thePuppet);
			return Boolean(puppetData && puppetData.puppetMxid === sender);
		}
	}

	public async getDbPuppetId(puppetId: number): Promise<number> {
		if (!this.enabled) {
			if (puppetId === -1) {
				throw new Error("Global namespace not enabled");
			}
			return puppetId;
		}
		if (puppetId === -1) {
			return -1;
		}
		const puppetData = await this.bridge.provisioner.get(puppetId);
		if (!puppetData) {
			throw new Error("Puppet not found");
		}
		if (puppetData.isGlobalNamespace) {
			return -1;
		}
		return puppetId;
	}

	public async getRoomCreateInfo(room: IRemoteRoom): Promise<IPuppetCreateInfo> {
		const ret = await this.maybeGetPuppetCreateInfo(room.puppetId);
		if (ret) {
			return ret;
		}
		if (!this.puppetsForRoom.has(room.roomId) || true) {
			await this.populatePuppetsForRoom(room.roomId);
		}
		const puppetIds = this.puppetsForRoom.get(room.roomId);
		return await this.getPuppetCreateInfo(puppetIds);
	}

	public async getGroupCreateInfo(group: IRemoteGroup): Promise<IPuppetCreateInfo> {
		const ret = await this.maybeGetPuppetCreateInfo(group.puppetId);
		if (ret) {
			return ret;
		}
		if (!this.puppetsForGroup.has(group.groupId) || true) {
			await this.populatePuppetsForGroup(group.groupId);
		}
		const puppetIds = this.puppetsForGroup.get(group.groupId);
		return await this.getPuppetCreateInfo(puppetIds);
	}

	public async createUser(user: IRemoteUser): Promise<IRemoteUser | null> {
		const validate = (origData: IRemoteUser, newData: IRemoteUser | null): IRemoteUser | null => {
			if (newData && newData.userId === origData.userId && newData.puppetId === origData.puppetId) {
				return newData;
			}
			log.warn("Override data is malformed! Old data:", origData, "New data:", newData);
			return null;
		};
		if (!this.bridge.hooks.createUser) {
			return null;
		}
		log.info("Fetching new user override data...");
		if (user.puppetId !== -1) {
			return validate(user, await this.bridge.hooks.createUser(user));
		}
		if (!this.enabled) {
			throw new Error("Global namespace not enabled");
		}
		if (!this.puppetsForUser.has(user.userId) || true) {
			await this.populatePuppetsForUser(user.userId);
		}
		const puppetIds = this.puppetsForUser.get(user.userId);
		if (!puppetIds) {
			return null;
		}
		let somePuppet = -1;
		for (const puppetId of puppetIds) {
			somePuppet = puppetId;
			break;
		}
		const oldData: IRemoteUser = {
			puppetId: somePuppet,
			userId: user.userId,
		};
		return validate(oldData, await this.bridge.hooks.createUser(oldData));
	}

	public async createRoom(room: IRemoteRoom): Promise<IRemoteRoom | null> {
		const validate = (origData: IRemoteRoom, newData: IRemoteRoom | null): IRemoteRoom | null => {
			if (newData && newData.roomId === origData.roomId && newData.puppetId === origData.puppetId) {
				return newData;
			}
			log.warn("Override data is malformed! Old data:", origData, "New data:", newData);
			return null;
		};
		if (!this.bridge.hooks.createRoom) {
			return null;
		}
		log.info("Fetching new room override data...");
		if (room.puppetId !== -1) {
			return validate(room, await this.bridge.hooks.createRoom(room));
		}
		if (!this.enabled) {
			throw new Error("Global namespace not enabled");
		}
		if (!this.puppetsForRoom.has(room.roomId) || true) {
			await this.populatePuppetsForRoom(room.roomId);
		}
		const puppetIds = this.puppetsForRoom.get(room.roomId);
		if (!puppetIds) {
			return null;
		}
		let somePuppet = -1;
		for (const puppetId of puppetIds) {
			somePuppet = puppetId;
			break;
		}
		const oldData: IRemoteRoom = {
			puppetId: somePuppet,
			roomId: room.roomId,
		};
		return validate(oldData, await this.bridge.hooks.createRoom(oldData));
	}

	public async createGroup(group: IRemoteGroup): Promise<IRemoteGroup | null> {
		const validate = (origData: IRemoteGroup, newData: IRemoteGroup | null): IRemoteGroup | null => {
			if (newData && newData.groupId === origData.groupId && newData.puppetId === origData.puppetId) {
				return newData;
			}
			log.warn("Override data is malformed! Old data:", origData, "New data:", newData);
			return null;
		};
		if (!this.bridge.hooks.createGroup) {
			return null;
		}
		log.info("Fetching new group override data...");
		if (group.puppetId !== -1) {
			return validate(group, await this.bridge.hooks.createGroup(group));
		}
		if (!this.enabled) {
			throw new Error("Global namespace not enabled");
		}
		if (!this.puppetsForGroup.has(group.groupId) || true) {
			await this.populatePuppetsForUser(group.groupId);
		}
		const puppetIds = this.puppetsForUser.get(group.groupId);
		if (!puppetIds) {
			return null;
		}
		let somePuppet = -1;
		for (const puppetId of puppetIds) {
			somePuppet = puppetId;
			break;
		}
		const oldData: IRemoteGroup = {
			puppetId: somePuppet,
			groupId: group.groupId,
		};
		return validate(oldData, await this.bridge.hooks.createGroup(oldData));
	}

	public async getRemoteUser(user: IRemoteUser | null, sender: string): Promise<IRemoteUser | null> {
		if (!user) {
			return null;
		}
		const puppetId = await this.getRemote(user.puppetId, user.userId, sender, this.puppetsForUser,
			this.populatePuppetsForUser.bind(this));
		return {
			puppetId,
			userId: user.userId,
		};
	}

	public async getRemoteRoom(room: IRemoteRoom | null, sender: string): Promise<IRemoteRoom | null> {
		if (!room) {
			return null;
		}
		const puppetId = await this.getRemote(room.puppetId, room.roomId, sender, this.puppetsForRoom,
			this.populatePuppetsForRoom.bind(this));
		return {
			puppetId,
			roomId: room.roomId,
		};
	}

	public async getRemoteGroup(group: IRemoteGroup | null, sender: string): Promise<IRemoteGroup | null> {
		if (!group) {
			return null;
		}
		const puppetId = await this.getRemote(group.puppetId, group.groupId, sender, this.puppetsForGroup,
			this.populatePuppetsForGroup.bind(this));
		return {
			puppetId,
			groupId: group.groupId,
		};
	}

	public async isMessageBlocked(params: IReceiveParams): Promise<boolean> {
		if (!this.enabled) {
			log.error("not blocked");
			return false;
		}
		const puppetData = await this.bridge.provisioner.get(params.room.puppetId);
		if (!puppetData) {
			throw new Error("Puppet not found");
		}
		if (!puppetData.isGlobalNamespace) {
			return false;
		}
		log.debug(`In global namespace, determining if it should be blocked... puppetId=${params.user.puppetId}` +
			` userId=${params.user.userId} roomId=${params.room.roomId}`);
		if (!this.usersInRoom.has(params.room.roomId) || true) {
			await this.populateUsersInRoom(params.room.roomId);
		}
		if (!this.puppetsForRoom.has(params.room.roomId) || true) {
			await this.populatePuppetsForRoom(params.room.roomId);
		}
		const userIds = this.usersInRoom.get(params.room.roomId);
		const puppetIds = this.puppetsForRoom.get(params.room.roomId);
		if (!userIds || !puppetIds) {
			log.error("Noone is in the room?!");
			throw new Error("Noone is in the room?!");
		}
		let relayPuppet = -1;
		for (const puppetId of puppetIds) {
			const thisPuppetData = await this.bridge.provisioner.get(puppetId);
			if (thisPuppetData) {
				if (thisPuppetData.userId && thisPuppetData.userId === params.user.userId) {
					const block = puppetId !== params.room.puppetId;
					log.debug(`Found user with puppetId=${puppetId}. block=${block}`);
					return block;
				}
				if (thisPuppetData.type === "relay") {
					relayPuppet = puppetId;
				}
			}
		}
		if (relayPuppet !== -1) {
			const block = params.room.puppetId !== relayPuppet;
			log.debug(`Found relay with puppetId=${relayPuppet}. block=${block}`);
			return block;
		}
		let somePuppet = -1;
		for (const puppetId of puppetIds) {
			somePuppet = puppetId;
			break;
		}
		if (somePuppet === -1) {
			log.debug("No user at all found?");
			return false;
		}
		{
			const block = params.room.puppetId !== somePuppet;
			log.debug(`Found some puppet with puppetId=${somePuppet}. block=${block}`);
			return block;
		}
	}

	private async maybeGetPuppetCreateInfo(puppetId: number): Promise<IPuppetCreateInfo | null> {
		if (!this.enabled) {
			if (puppetId === -1) {
				throw new Error("Global namespace not enabled");
			}
			const puppetData = await this.bridge.provisioner.get(puppetId);
			return {
				public: Boolean(puppetData && puppetData.isPublic),
				invites: new Set(puppetData && puppetData.autoinvite ? [puppetData.puppetMxid] : []),
			};
		}
		if (puppetId !== -1) {
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (!puppetData) {
				throw new Error("Puppet not found");
			}
			if (!puppetData.isGlobalNamespace) {
				return {
					public: puppetData.isPublic,
					invites: new Set(puppetData.autoinvite ? [puppetData.puppetMxid] : []),
				};
			}
		}
		return null;
	}

	private async getPuppetCreateInfo(puppetIds?: Set<number>): Promise<IPuppetCreateInfo> {
		const info: IPuppetCreateInfo = {
			public: false,
			invites: new Set<string>(),
		};
		if (!puppetIds) {
			return info;
		}
		for (const puppetId of puppetIds) {
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (puppetData) {
				if (puppetData.isPublic) {
					info.public = true;
				}
				info.invites.add(puppetData.puppetMxid);
			}
		}
		return info;
	}

	private async populateUsersInRoom(roomId: string) {
		if (!this.bridge.hooks.getUserIdsInRoom) {
			this.usersInRoom.delete(roomId);
			return;
		}
		const users = new Set<string>();
		const allPuppets = await this.bridge.provisioner.getAll();
		for (const puppet of allPuppets) {
			const userIds = await this.bridge.hooks.getUserIdsInRoom({
				puppetId: puppet.puppetId,
				roomId,
			});
			if (userIds) {
				for (const userId of userIds) {
					users.add(userId);
				}
				if (puppet.userId) {
					users.add(puppet.userId); // also set ourselves to be present in the room
				}
			}
		}
		this.usersInRoom.set(roomId, users);
	}

	private async getRemote(
		puppetId: number,
		id: string,
		sender: string,
		map: Map<string, Set<number>>,
		populate: (id: string) => Promise<void>,
	) {
		if (!this.enabled) {
			if (puppetId === -1) {
				throw new Error("Global namespace not enabled");
			}
			return puppetId;
		}
		if (puppetId !== -1) {
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (puppetData && !puppetData.isGlobalNamespace) {
				return puppetId;
			}
		}
		if (true || !map.has(id)) {
			await populate(id);
		}
		const puppetIds = map.get(id);
		if (!puppetIds) {
			return await this.getRelay();
		}
		let relayPuppetId = -1;
		for (const thisPuppetId of puppetIds) {
			const puppetData = await this.bridge.provisioner.get(thisPuppetId);
			if (puppetData && puppetData.puppetMxid === sender) {
				return thisPuppetId;
			}
			if (puppetData && puppetData.type === "relay") {
				relayPuppetId = thisPuppetId;
			}
		}
		if (relayPuppetId === -1) {
			return await this.getRelay();
		}
		return relayPuppetId;
	}

	private async populatePuppetsForUser(userId: string) {
		await this.populateThingForPuppet(userId, this.puppetsForUser, async (puppetId: number) => {
			if (!this.bridge.hooks.userExists) {
				return false;
			}
			return await this.bridge.hooks.userExists({ puppetId, userId });
		});
	}

	private async populatePuppetsForRoom(roomId: string) {
		await this.populateThingForPuppet(roomId, this.puppetsForRoom, async (puppetId: number) => {
			if (!this.bridge.hooks.roomExists) {
				return false;
			}
			return await this.bridge.hooks.roomExists({ puppetId, roomId });
		});
	}

	private async populatePuppetsForGroup(groupId: string) {
		await this.populateThingForPuppet(groupId, this.puppetsForGroup, async (puppetId: number) => {
			if (!this.bridge.hooks.groupExists) {
				return false;
			}
			return await this.bridge.hooks.groupExists({ puppetId, groupId });
		});
	}

	private async populateThingForPuppet(
		id: string,
		map: Map<string, Set<number>>,
		have: (puppetId: number) => Promise<boolean>,
	) {
		const puppets = new Set<number>();
		const allPuppets = await this.bridge.provisioner.getAll();
		for (const puppet of allPuppets) {
			if (puppet.isGlobalNamespace && await have(puppet.puppetId)) {
				puppets.add(puppet.puppetId);
			}
		}
		map.set(id, puppets);
	}

	private async getRelay(): Promise<number> {
		const allPuppets = await this.bridge.provisioner.getAll();
		for (const puppet of allPuppets) {
			if (puppet.type === "relay" && puppet.isGlobalNamespace) {
				return puppet.puppetId;
			}
		}
		throw new Error("No relay found");
	}
}
