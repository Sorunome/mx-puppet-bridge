export class Lock<T> {
	private locks: Map<T, {i: NodeJS.Timeout|null, r: (() => void)|null}>;
	private lockPromises: Map<T, Promise<{}>>;
	constructor(
		private timeout: number,
	) {
		this.locks = new Map();
		this.lockPromises = new Map();
	}

	public set(key: T) {
		if (this.locks.has(key)) {
			return;
		}

		// set flag that we are locking this
		this.locks.set(key, {i: null, r: null});
		const p = new Promise<{}>((resolve) => {
			if (!this.locks.has(key)) {
				resolve();
				return;
			}
			const i = setTimeout(() => {
				this.release(key);
			}, this.timeout);
			const o = {r: resolve, i};
			this.locks.set(key, o);
		});
		this.lockPromises.set(key, p);
	}

	public release(key: T) {
		if (!this.locks.has(key)) {
			return;
		}
		const lock = this.locks.get(key)!;
		if (lock.r !== null) {
			lock.r();
		}
		if (lock.i !== null) {
			clearTimeout(lock.i);
		}
		this.locks.delete(key);
		this.lockPromises.delete(key);
	}

	public async wait(key: T) {
		const promise = this.lockPromises.get(key);
		if (promise) {
			await promise;
		}
	}
}
