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

	public async get(puppetId: number): Promise<IPuppet | null> {
		return await this.puppetStore.get(puppetId);
	}

	public async getMxid(puppetId: number): Promise<string> {
		return await this.puppetStore.getMxid(puppetId);
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.puppetStore.setUserId(puppetId, userId);
	}

	public async setData(puppetId: number, data: any) {
		await this.puppetStore.setData(puppetId, data);
	}
}
