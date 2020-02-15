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

const GC_DELAY = 5;

export class ExpireSet<T> {
	private db: Map<T, number>;
	private nextGc: NodeJS.Timeout | null;
	private gcDelay: number;
	constructor(
		private timeout: number,
		gcDelay?: number,
	) {
		this.db = new Map();
		this.nextGc = null;
		this.gcDelay = gcDelay || GC_DELAY;
	}

	get size(): number {
		return this.db.size;
	}

	get all(): Set<T> {
		const s = new Set<T>();
		this.db.forEach((_, v) => {
			s.add(v);
		});
		return s;
	}

	public add(value: T) {
		this.db.set(value, Date.now() + this.timeout);
		this.scheduleGc();
		return this;
	}

	public has(value: T): boolean {
		return this.db.has(value);
	}

	public delete(value: T) {
		if (this.db.has(value)) {
			this.db.delete(value);
			this.scheduleGc(true);
		}
		return this;
	}

	private gc() {
		const now = Date.now();
		this.db.forEach((t, v) => {
			if (t < now) {
				this.db.delete(v);
			}
		});
		this.nextGc = null;
		this.scheduleGc();
	}

	private scheduleGc(force: boolean = false) {
		if (force && this.nextGc) {
			clearTimeout(this.nextGc);
			this.nextGc = null;
		}
		if (this.nextGc !== null || this.db.size === 0) {
			return;
		}
		let ts = -1;
		this.db.forEach((t) => {
			if (ts === -1 || t < ts) {
				ts = t;
			}
		});
		if (ts === -1) {
			ts = Date.now();
		}
		const timeout = ts - Date.now() + this.gcDelay;
		this.nextGc = setTimeout(this.gc.bind(this), timeout);
	}
}
