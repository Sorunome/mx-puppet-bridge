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
import { IRemoteUser, IRemoteRoom, IRemoteGroup } from "./interfaces";

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
			if (!this.bridge.hooks.createUser) {
				return false;
			}
			const user = await this.bridge.hooks.createUser({
				puppetId,
				userId,
			});
			return Boolean(user);
		});
	}

	private async populatePuppetsForRoom(roomId: string) {
		await this.populateThingForPuppet(roomId, this.puppetsForRoom, async (puppetId: number) => {
			if (!this.bridge.hooks.createRoom) {
				return false;
			}
			const room = await this.bridge.hooks.createRoom({
				puppetId,
				roomId,
			});
			return Boolean(room);
		});
	}

	private async populatePuppetsForGroup(groupId: string) {
		await this.populateThingForPuppet(groupId, this.puppetsForGroup, async (puppetId: number) => {
			if (!this.bridge.hooks.createGroup) {
				return false;
			}
			const group = await this.bridge.hooks.createGroup({
				puppetId,
				groupId,
			});
			return Boolean(group);
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
			if (await have(puppet.puppetId)) {
				puppets.add(puppet.puppetId);
			}
		}
		map.set(id, puppets);
	}

	private async getRelay(): Promise<number> {
		const allPuppets = await this.bridge.provisioner.getAll();
		for (const puppet of allPuppets) {
			if (puppet.type === "relay") {
				return puppet.puppetId;
			}
		}
		throw new Error("No relay found");
	}
}
