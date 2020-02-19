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
import { IRemoteRoom, IRemoteUser, IReceiveParams } from "./interfaces";
import { MatrixClient, RedactionEvent } from "matrix-bot-sdk";
import { DbReactionStore, IReactionStoreEntry } from "./db/reactionstore";
import { Log } from "./log";

const log = new Log("ReactionHandler");

export class ReactionHandler {
	private reactionStore: DbReactionStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.reactionStore = this.bridge.reactionStore;
	}

	public async addRemote(params: IReceiveParams, eventId: string, key: string, client: MatrixClient, mxid: string) {
		log.info(`Received reaction from ${params.user.userId} to send to ${params.room.roomId}, message ${eventId}`);
		const origEvent = (await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId))[0];
		if (!origEvent) {
			log.warn("No original event found, ignoring...");
			return; // nothing to do
		}
		// okay, let's create a dummy entry and check if the reaction exists already
		const entry: IReactionStoreEntry = {
			puppetId: params.room.puppetId,
			roomId: params.room.roomId,
			userId: params.user.userId,
			eventId,
			reactionMxid: "", // to fill in later
			key,
		};
		if (await this.reactionStore.exists(entry)) {
			log.warn("Reaction already exists, ignoring...");
			return;
		}
		// this type needs to be any-type, as the interfaces don't do reactions yet
		const send = {
			"source": this.bridge.protocol.id,
			"m.relates_to": {
				rel_type: "m.annotation",
				event_id: origEvent,
				key,
			},
		} as any; // tslint:disable-line no-any
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendEvent(mxid, "m.reaction", send);
		if (matrixEventId && params.eventId) {
			await this.bridge.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
		// and finally save the reaction to our reaction store
		entry.reactionMxid = matrixEventId;
		await this.reactionStore.insert(entry);
	}

	public async removeRemote(params: IReceiveParams, eventId: string, key: string, client: MatrixClient, mxid: string) {
		log.info(`Removing reaction from ${params.user.userId} in ${params.room.roomId}, message ${eventId}`);
		const origEvent = (await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId))[0];
		if (!origEvent) {
			log.warn("No original event found, ignoring...");
			return; // nothing to do
		}
		// okay, let's fetch the reaction from the DB
		const entry: IReactionStoreEntry = {
			puppetId: params.room.puppetId,
			roomId: params.room.roomId,
			userId: params.user.userId,
			eventId,
			reactionMxid: "", // to fill in later
			key,
		};
		const reaction = await this.reactionStore.getFromKey(entry);
		if (!reaction) {
			log.warn("Reaction not found, ignoring...");
			return;
		}
		// alright, we found our reaction we need to redact!
		await this.bridge.redactEvent(client, mxid, reaction.reactionMxid);
		// don't forget to delete it off of the DB!
		await this.reactionStore.delete(reaction.reactionMxid);
	}

	public async removeRemoteAllOnMessage(params: IReceiveParams, eventId: string, client: MatrixClient, mxid: string) {
		log.info(`Removing all reactions from message ${eventId} in ${params.room.roomId}`);
		const origEvent = (await this.bridge.eventStore.getMatrix(params.room.puppetId, eventId))[0];
		if (!origEvent) {
			log.warn("No original event found, ignoring...");
			return; // nothing to do
		}
		const reactions = await this.reactionStore.getForEvent(params.room.puppetId, eventId);
		for (const reaction of reactions) {
			await this.bridge.redactEvent(client, mxid, reaction.reactionMxid);
		}
		await this.reactionStore.deleteForEvent(params.room.puppetId, eventId);
	}

	public async addMatrix(room: IRemoteRoom, eventId: string, reactionMxid: string, key: string) {
		const puppet = await this.bridge.provisioner.get(room.puppetId);
		if (!puppet || !puppet.userId) {
			return;
		}
		log.info(`Got reaction from matrix in room ${room.roomId} to add...`);
		const entry: IReactionStoreEntry = {
			puppetId: room.puppetId,
			roomId: room.roomId,
			userId: puppet.userId,
			eventId,
			reactionMxid,
			key,
		};
		await this.reactionStore.insert(entry);
	}

	public async handleRedactEvent(room: IRemoteRoom, event: RedactionEvent) {
		for (const redacts of event.redactsEventIds) {
			const reaction = await this.reactionStore.getFromReactionMxid(redacts);
			if (!reaction) {
				continue;
			}
			log.info("Got redaction of reaction to processs...");
			if (reaction.roomId !== room.roomId || reaction.puppetId !== room.puppetId) {
				log.warn("Redacted reaction isn't from our room, this is odd");
				continue;
			}
			log.debug("Emitting removeReaction event...");
			this.bridge.emit("removeReaction", room, reaction.eventId, reaction.key, event);
			// and finally delete it off of the DB
			await this.reactionStore.delete(reaction.reactionMxid);
		}
	}
}
