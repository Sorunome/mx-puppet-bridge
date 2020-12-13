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

import { Lock } from "./lock";
import ExpireSet from "expire-set";

const DEFAULT_LOCK_TIMEOUT = 30000;
const DEFAULT_LOCK_DATA_TIMEOUT = 300000;

export class MessageDeduplicator {
	private locks: Lock<string>;
	private lockDataTimeout: number;
	private data: ExpireSet<string>;
	private authorIds: ExpireSet<string>;
	constructor(
		lockTimeout?: number,
		lockDataTimeout?: number,
	) {
		this.locks = new Lock(lockTimeout || DEFAULT_LOCK_TIMEOUT);
		const ldt = lockDataTimeout || DEFAULT_LOCK_DATA_TIMEOUT;
		this.data = new ExpireSet(ldt);
		this.authorIds = new ExpireSet(ldt);
	}

	public lock(roomId: string, authorId: string, message?: string) {
		this.locks.set(roomId);
		this.authorIds.add(authorId);
		if (message) {
			this.data.add(`${roomId};${authorId};m:${message}`);
		}
	}

	public unlock(roomId: string, authorId?: string, eventId?: string) {
		if (authorId) {
			this.authorIds.add(authorId);
		}
		if (authorId && eventId) {
			this.data.add(`${roomId};${authorId};e:${eventId}`);
		}
		this.locks.release(roomId);
	}

	public async dedupe(
		roomId: string,
		authorId: string,
		eventId?: string,
		message?: string,
		clear: boolean = true,
	): Promise<boolean> {
		if (!this.authorIds.has(authorId)) {
			return false;
		}
		await this.locks.wait(roomId);
		let returnValue = false;
		if (eventId) {
			const key = `${roomId};${authorId};e:${eventId}`;
			if (this.data.has(key)) {
				if (clear) {
					this.data.delete(key);
				}
				returnValue = true;
			}
		}
		if (message) {
			const key = `${roomId};${authorId};m:${message}`;
			if (this.data.has(key)) {
				if (clear) {
					this.data.delete(key);
				}
				returnValue = true;
			}
		}
		return returnValue;
	}

	public dispose() {
		for (const key of this.data.all) {
			this.data.delete(key);
		}
		for (const key of this.authorIds.all) {
			this.authorIds.delete(key);
		}
		this.locks.dispose();
	}
}
