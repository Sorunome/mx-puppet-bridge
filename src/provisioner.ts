import { PuppetBridge } from "./puppetbridge";
import { DbPuppetStore, IPuppet } from "./db/puppetstore";
import { Log } from "./log";

const log = new Log("Provisioner");

export interface IProvisionerDesc {
	puppetId: number;
	desc: string;
	html: string;
}

export class Provisioner {
	private puppetStore: DbPuppetStore;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.puppetStore = this.bridge.puppetStore;
	}

	public async getAll(): Promise<IPuppet[]> {
		return await this.puppetStore.getAll();
	}

	public async getForMxid(puppetMxid: string): Promise<IPuppet[]> {
		return await this.puppetStore.getForMxid(puppetMxid);
	}

	public async get(puppetId: number): Promise<IPuppet | null> {
		return await this.puppetStore.get(puppetId);
	}

	public async getMxid(puppetMxid: number): Promise<string> {
		return await this.puppetStore.getMxid(puppetMxid);
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.puppetStore.setUserId(puppetId, userId);
	}

	public async setData(puppetId: number, data: any) {
		await this.puppetStore.setData(puppetId, data);
	}

	public canCreate(mxid: string): boolean {
		for (const b of this.bridge.config.provisioning.blacklist) {
			if (mxid.match(b)) {
				return false;
			}
		}
		let whitelisted = false;
		for (const w of this.bridge.config.provisioning.whitelist) {
			if (mxid.match(w)) {
				whitelisted = true;
				break;
			}
		}
		return whitelisted;
	}

	public async new(puppetMxid: string, data: any, userId?: string): Promise<number> {
		if (!this.canCreate(puppetMxid)) {
			return -1;
		}
		const puppetId = await this.puppetStore.new(puppetMxid, data, userId);
		log.info(`Created new puppet with id ${puppetId}`);
		this.bridge.emit("puppetNew", puppetId, data);
		return puppetId;
	}

	public async delete(puppetMxid: string, puppetId: number) {
		log.info(`Deleting puppet with id ${puppetId}`);
		const data = await this.get(puppetId);
		if (!data || data.puppetMxid !== puppetMxid) {
			return;
		}
		await this.puppetStore.delete(puppetId);
		await this.bridge.chanSync.deleteForPuppet(puppetId);
		this.bridge.emit("puppetDelete", puppetId);
	}

	public async getDesc(puppetMxid: string, puppetId: number): Promise<IProvisionerDesc | null> {
		const data = await this.get(puppetId);
		if (!data || data.puppetMxid !== puppetMxid) {
			return null;
		}
		return await this.getDescFromData(data);
	}

	public async getDescMxid(puppetMxid: string): Promise<IProvisionerDesc[]> {
		const datas = await this.getForMxid(puppetMxid);
		const descs = [] as IProvisionerDesc[];
		for (const data of datas) {
			descs.push(await this.getDescFromData(data));
		}
		return descs;
	}

	private async getDescFromData(data: any): Promise<IProvisionerDesc> {
		if (!this.bridge.hooks.getDesc) {
			return {
				puppetId: data.puppetId,
				desc: `${data.puppetMxid} (${data.puppetId})`,
				html: `${data.puppetMxid} (${data.puppetId})`,
			} as IProvisionerDesc;
		}
		return {
			puppetId: data.puppetId,
			desc: await this.bridge.hooks.getDesc(data.puppetId, data.data, false),
			html: await this.bridge.hooks.getDesc(data.puppetId, data.data, true),
		} as IProvisionerDesc;
	}
}
