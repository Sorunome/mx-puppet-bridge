type DelayedFunctionFn = () => void | Promise<void>;

export class DelayedFunction {
	private readonly map: Map<string, NodeJS.Timeout>;

	public constructor() {
		this.map = new Map();
	}

	public set(key: string, fn: DelayedFunctionFn, timeout: number) {
		// clear the old timeout
		this.release(key);

		// set the new timeout
		const i = setTimeout(() => {
			this.map.delete(key);
			fn();
		}, timeout);
		this.map.set(key, i);
	}

	public release(key: string) {
		if (!this.map.has(key)) {
			return;
		}
		clearTimeout(this.map.get(key)!);
		this.map.delete(key);
	}
}
