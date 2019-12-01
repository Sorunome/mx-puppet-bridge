import { PuppetBridge } from "./puppetbridge";
import { DbPuppetStore, IPuppet } from "./db/puppetstore";
import { Log } from "./log";
import { Util } from "./util";

const log = new Log("Provisioner");

export interface IProvisionerDesc {
	puppetId: number;
	desc: string;
}

export interface ITokenResponse {
	token: string;
	hsUrl: string;
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

	public async getMxid(puppetId: number): Promise<string> {
		return await this.puppetStore.getMxid(puppetId);
	}

	public async parseToken(mxid: string, token: string): Promise<ITokenResponse> {
		let hsUrl = mxid.split(":")[1];
		if (hsUrl === "localhost") {
			hsUrl = "http://" + hsUrl;
		} else {
			hsUrl = "https://" + hsUrl;
		}
		try {
			const wellKnownStr = (await Util.DownloadFile(hsUrl + "/.well-known/matrix/client")).toString("utf-8");
			const wellKnown = JSON.parse(wellKnownStr);
			hsUrl = wellKnown["m.homeserver"].base_url;
		} catch (err) { } // do nothing
		return { token, hsUrl } as ITokenResponse;
	}

	public async getToken(puppetId: number | string): Promise<ITokenResponse | null> {
		let mxid = "";
		if (typeof puppetId === "string") {
			mxid = puppetId;
		} else {
			mxid = await this.getMxid(puppetId);
		}
		const info = await this.puppetStore.getMxidInfo(mxid);
		if (!info || !info.token) {
			return null;
		}
		return await this.parseToken(mxid, info.token);
	}

	public async setToken(mxid: string, token: string | null) {
		const info = await this.puppetStore.getOrCreateMxidInfo(mxid);
		info.token = token;
		await this.puppetStore.setMxidInfo(info);
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.puppetStore.setUserId(puppetId, userId);
	}

	public async setData(puppetId: number, data: any) {
		await this.puppetStore.setData(puppetId, data);
	}

	public canCreate(mxid: string): boolean {
		return this.isWhitelisted(mxid, this.bridge.config.provisioning.whitelist,
			this.bridge.config.provisioning.blacklist);
	}

	public canRelay(mxid: string): boolean {
		return this.isWhitelisted(mxid, this.bridge.config.relay.whitelist,
			this.bridge.config.relay.blacklist);
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

	public async update(puppetMxid: string, puppetId: number, data: any, userId?: string) {
		if (!this.canCreate(puppetMxid)) {
			return;
		}
		const d = await this.get(puppetId);
		if (!d || d.puppetMxid !== puppetMxid) {
			return;
		}
		await this.setData(puppetId, data);
		if (userId) {
			await this.setUserId(puppetId, userId);
		}
		log.info(`Updating puppet with id ${puppetId}`);
		this.bridge.emit("puppetNew", puppetId, data);
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
			} as IProvisionerDesc;
		}
		return {
			puppetId: data.puppetId,
			desc: await this.bridge.hooks.getDesc(data.puppetId, data.data),
		} as IProvisionerDesc;
	}

	private isWhitelisted(mxid: string, whitelist: string[], blacklist: string[]): boolean {
		for (const b of blacklist) {
			if (mxid.match(b)) {
				return false;
			}
		}
		for (const w of whitelist) {
			if (mxid.match(w)) {
				return true;
			}
		}
		return false;
	}
}
