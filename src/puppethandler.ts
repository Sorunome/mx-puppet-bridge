import { PuppetBridge } from "./puppetbridge";
import { DbPuppetStore, IPuppet } from "./db/puppetstore";
import { Log } from "./log";

const log = new Log("PuppetHandler");

export class PuppetHandler {
	private puppetStore: DbPuppetStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.puppetStore = this.bridge.puppetStore;
	}

	public async getAll(): Promise<IPuppet[]> {
		return await this.puppetStore.getAll();
	}
}
