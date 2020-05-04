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
import { DbEmoteStore } from "./db/emotestore";
import { Util } from "./util";
import { IRemoteEmote, IRemoteRoom } from "./interfaces";
import { Log } from "./log";
import { Lock } from "./structures/lock";

const log = new Log("EmoteSync");

// tslint:disable-next-line:no-magic-numbers
const EMOTE_SET_LOCK_TIMEOUT = 1000 * 60;

interface IPoniesRoomEmotesContent {
	short: {
		[key: string]: string;
	};
}

export class EmoteSyncroniser {
	private emoteStore: DbEmoteStore;
	private emoteSetLock: Lock<string>;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.emoteStore = this.bridge.store.emoteStore;
		this.emoteSetLock = new Lock(EMOTE_SET_LOCK_TIMEOUT);
	}

	public async set(data: IRemoteEmote, updateRoom: boolean = true): Promise<{emote: IRemoteEmote; update: boolean; }> {
		log.info(`Setting new emote ${data.emoteId} in ${data.roomId}...`);
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(data.puppetId);
		const lockKey = `${dbPuppetId};${data.roomId};${data.emoteId}`;
		this.emoteSetLock.set(lockKey);
		try {
			let emote = await this.emoteStore.get(dbPuppetId, data.roomId || null, data.emoteId);
			if (!emote) {
				// okay, we need to create a new one
				emote = this.emoteStore.newData(dbPuppetId, data.roomId || null, data.emoteId);
			}
			const updateProfile = await Util.ProcessProfileUpdate(
				emote, data, this.bridge.protocol.namePatterns.emote,
				async (buffer: Buffer, mimetype?: string, filename?: string) => {
					return await this.bridge.uploadContent(null, buffer, mimetype, filename);
				},
			);
			emote = Object.assign(emote, updateProfile);
			if (data.data) {
				emote.data = data.data;
			}
			const doUpdate = updateProfile.hasOwnProperty("name") || updateProfile.hasOwnProperty("avatarMxc");
			if (doUpdate) {
				await this.emoteStore.set(emote);
			}
			if (updateRoom && doUpdate && data.roomId) {
				await this.updateRoom(data as IRemoteRoom);
			}
			this.emoteSetLock.release(lockKey);
			return {
				emote,
				update: doUpdate,
			};
		} catch (err) {
			log.error("Error updating emote:", err.error || err.body || err);
			this.emoteSetLock.release(lockKey);
			throw err;
		}
	}

	public async get(search: IRemoteEmote): Promise<IRemoteEmote | null> {
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(search.puppetId);
		let emote = await this.emoteStore.get(dbPuppetId, search.roomId || null, search.emoteId);
		if (emote) {
			return emote;
		}
		if (search.roomId) {
			emote = await this.emoteStore.get(dbPuppetId, null, search.emoteId);
			return emote;
		}
		return null;
	}

	public async getByMxc(roomOrPuppet: IRemoteRoom | number, mxc: string): Promise<IRemoteEmote | null> {
		let puppetId: number;
		let roomId: string | null = null;
		if (typeof roomOrPuppet === "number") {
			puppetId = roomOrPuppet;
		} else {
			puppetId = roomOrPuppet.puppetId;
			roomId = roomOrPuppet.roomId;
		}
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(puppetId);
		let emote = await this.emoteStore.getByMxc(dbPuppetId, roomId, mxc);
		if (emote) {
			return emote;
		}
		if (roomId) {
			emote = await this.emoteStore.getByMxc(dbPuppetId, null, mxc);
			return emote;
		}
		return null;
	}

	public async setMultiple(emotes: IRemoteEmote[]) {
		const updateRooms = new Map<string, IRemoteRoom>();
		for (const emote of emotes) {
			const { update } = await this.set(emote, false);
			if (update && emote.roomId) {
				updateRooms.set(`${emote.puppetId};${emote.roomId}`, emote as IRemoteRoom);
			}
		}
		for (const [, room] of updateRooms) {
			await this.updateRoom(room);
		}
	}

	public async updateRoom(room: IRemoteRoom) {
		log.info(`Updating emote state event in ${room.roomId}...`);
		const roomId = await this.bridge.roomSync.maybeGetMxid(room);
		if (!roomId) {
			log.warn("No room ID found, this is odd");
			return;
		}
		const client = await this.bridge.roomSync.getRoomOp(roomId);
		if (!client) {
			log.warn("No OP client found, this is odd");
			return;
		}
		const dbPuppetId = await this.bridge.namespaceHandler.getDbPuppetId(room.puppetId);
		const emotes = await this.emoteStore.getForRoom(dbPuppetId, room.roomId);
		const stateEventContent: IPoniesRoomEmotesContent = {
			short: {},
		};
		for (const e of emotes) {
			if (e.name && e.avatarMxc) {
				stateEventContent.short[e.name] = e.avatarMxc;
			}
		}
		await client.sendStateEvent(roomId, "im.ponies.room_emotes", "", stateEventContent);
	}
}
