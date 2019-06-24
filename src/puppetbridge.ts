import * as fs from "fs";
import {
	Appservice,
	IAppserviceRegistration,
	Intent,
	MatrixClient,
	SimpleRetryJoinStrategy,
} from "matrix-bot-sdk";
import * as uuid from "uuid/v4";
import * as yaml from "js-yaml";
import { EventEmitter } from "events";
import { ChannelSyncroniser, IRemoteChanSend, IRemoteChanReceive } from "./channelsyncroniser";
import { UserSyncroniser, IRemoteUserReceive } from "./usersyncroniser";
import { MxBridgeConfig } from "./config";
import { Util } from "./util";
import { Log } from "./log";
import { DbUserStore } from "./db/userstore";
import { DbChanStore } from "./db/chanstore";
import { DbPuppetStore } from "./db/puppetstore";
import { Provisioner } from "./provisioner";
import { Store } from "./store";
import { TimedCache } from "./structures/timedcache";
import { PuppetBridgeJoinRoomStrategy } from "./joinstrategy";

const log = new Log("PuppetBridge");

const PUPPET_INVITE_CACHE_LIFETIME = 1000*60*60*24;

interface ISendInfo {
	client: MatrixClient;
	mxid: string;
};

export interface IPuppetBridgeRegOpts {
	prefix: string;
	id: string;
	url: string;
	botUser?: string;
};

export interface IPuppetBridgeFeatures {
	// file features
	file?: boolean;
	image?: boolean;
	audio?: boolean;
	video?: boolean;
	// stickers
	sticker?: boolean;
};

export interface IReceiveParams {
	chan: IRemoteChanReceive;
	user: IRemoteUserReceive;
};

export interface ISendMessageOpts {
	body: string;
	formatted_body?: string;
	emote?: boolean;
	notice?: boolean;
};

export interface IMessageEvent {
	body: string;
	formatted_body?: string;
	emote: boolean;
};

export interface IFileEvent {
	filename: string;
	info?: {
		mimetype?: string;
		size?: number;
		w?: number;
		h?: number;
	};
	mxc: string;
	url: string;
};

export type CreateChanHook = (puppetId: number, chanId: string) => Promise<IRemoteChanReceive | null>;
export type CreateUserHook = (puppetId: number, userId: string) => Promise<IRemoteUserReceive | null>;
export type GetDescHook = (puppetId: number, data: any, html: boolean) => Promise<string>;

export interface IPuppetBridgeHooks {
	createChan?: CreateChanHook;
	createUser?: CreateUserHook;
	getDesc?: GetDescHook;
};

export class PuppetBridge extends EventEmitter {
	public chanSync: ChannelSyncroniser;
	public userSync: UserSyncroniser;
	public hooks: IPuppetBridgeHooks;
	public config: MxBridgeConfig;
	private appservice: Appservice;
	private provisioner: Provisioner;
	private store: Store;
	private ghostInviteCache: TimedCache<string, boolean>;

	constructor(
		private registrationPath: string,
		private configPath: string,
		private features: IPuppetBridgeFeatures,
	) {
		super();
		this.ghostInviteCache = new TimedCache(PUPPET_INVITE_CACHE_LIFETIME);
		this.hooks = {} as IPuppetBridgeHooks;
	}

	public async readConfig() {
		this.config = new MxBridgeConfig();
		this.config.applyConfig(yaml.safeLoad(fs.readFileSync(this.configPath, "utf8")));
		Log.Configure(this.config.logging);
	}

	public async init() {
		this.readConfig();
		this.store = new Store(this.config.database);
		await this.store.init();

		this.chanSync = new ChannelSyncroniser(this);
		this.userSync = new UserSyncroniser(this);
		this.provisioner = new Provisioner(this);
	}

	public generateRegistration(opts: IPuppetBridgeRegOpts) {
		log.info("Generating registration file...");
		if (fs.existsSync(this.registrationPath)) {
			log.error("Registration file already exists!");
			throw new Error("Registration file already exists!");
		}
		if (!opts.botUser) {
			opts.botUser = opts.prefix + "bot";
		}
		const reg = {
			as_token: uuid(),
			hs_token: uuid(),
			id: opts.id,
			namespaces: {
				users: [
					{
						exclusive: true,
						regex: `@${opts.prefix}.*`,
					},
				],
				rooms: [ ],
				aliases: [ ],
			},
			protocols: [ ],
			rate_limit: false,
			sender_localpart: opts.botUser,
			url: opts.url,
		} as IAppserviceRegistration;
		fs.writeFileSync(this.registrationPath, yaml.safeDump(reg));
	}

	get AS(): Appservice {
		return this.appservice;
	}

	get botIntent(): Intent {
		return this.appservice.botIntent;
	}

	get userStore(): DbUserStore {
		return this.store.userStore;
	}

	get chanStore(): DbChanStore {
		return this.store.chanStore;
	}

	get puppetStore(): DbPuppetStore {
		return this.store.puppetStore;
	}

	get Config(): MxBridgeConfig {
		return this.config;
	}

	public async start() {
		log.info("Starting application service....");
		const registration = yaml.safeLoad(fs.readFileSync(this.registrationPath, "utf8")) as IAppserviceRegistration;
		this.appservice = new Appservice({
			bindAddress: this.config.bridge.bindAddress,
			homeserverName: this.config.bridge.domain,
			homeserverUrl: this.config.bridge.homeserverUrl,
			port: this.config.bridge.port,
			registration,
			joinStrategy: new PuppetBridgeJoinRoomStrategy(new SimpleRetryJoinStrategy(), this),
		});
		this.appservice.on("room.event", this.handleRoomEvent.bind(this));
		this.appservice.on("room.invite", this.handleInviteEvent.bind(this));
		await this.appservice.begin();
		log.info("Application service started!");
		log.info("Activating users...");
		const puppets = await this.provisioner.getAll();
		for (const p of puppets) {
			this.emit("puppetNew", p.puppetId, p.data);
		}
	}

	public setCreateChanHook(hook: CreateChanHook) {
		this.hooks.createChan = hook;
	}

	public setCreateUserHook(hook: CreateUserHook) {
		this.hooks.createUser = hook;
	}

	public setGetDescHook(hook: GetDescHook) {
		this.hooks.getDesc = hook;
	}

	public async setUserId(puppetId: number, userId: string) {
		await this.provisioner.setUserId(puppetId, userId);
	}

	public async setPuppetData(puppetId: number, data: any) {
		await this.provisioner.setData(puppetId, data);
	}

	public async updateUser(user: IRemoteUserReceive) {
		log.verbose("Got request to update a user");
		await this.userSync.getClient(user);
	}

	public async updateChannel(chan: IRemoteChanReceive) {
		log.verbose("Got request to update a channel");
		await this.chanSync.getMxid(chan);
	}

	public async getMxidForUser(userId: string, puppetId?: number): Promise<string> {
		if (puppetId) {
			const puppetData = await this.provisioner.get(puppetId);
			if (puppetData && puppetData.userId === userId) {
				return puppetData.puppetMxid;
			}
		}
		return this.appservice.getUserIdForSuffix(Util.str2mxid(userId));
	}

	public async sendFileDetect(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("detect", params, thing, name);
	}

	public async sendFile(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.file", params, thing, name);
	}

	public async sendVideo(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.video", params, thing, name);
	}

	public async sendAudio(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.audio", params, thing, name);
	}

	public async sendImage(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.image", params, thing, name);
	}

	public async sendMessage(params: IReceiveParams, opts: ISendMessageOpts) {
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const send = {
			msgtype,
			body: opts.body,
		} as any;
		if (opts.formatted_body) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = opts.formatted_body;
		}
		await client.sendMessage(mxid, send);
	}

	private async sendFileByType(msgtype: string, params: IReceiveParams, thing: string | Buffer, name?: string) {
		const { client, mxid } = await this.prepareSend(params);
		let buffer: Buffer;
		if (typeof thing === "string") {
			buffer = await Util.DownloadFile(thing);
		} else {
			buffer = thing;
		}
		const mimetype = Util.GetMimeType(buffer);
		if (msgtype === "detect") {
			if (mimetype) {
				const type = mimetype.split("/")[0];
				msgtype = {
					audio: "m.audio",
					image: "m.image",
					video: "m.video",
				}[type];
				if (!msgtype) {
					msgtype = "m.file";
				}
			} else {
				msgtype = "m.file";
			}
		}
		const fileMxc = await client.uploadContent(
			buffer,
			mimetype,
			name,
		);
		const info = {
			mimetype,
			size: buffer.byteLength,
		};
		const sendData = {
			body: name,
			info,
			msgtype,
			url: fileMxc,
		} as any;
		if (typeof thing === "string") {
			sendData.external_url = thing;
		}
		await client.sendMessage(mxid, sendData);
	}

	private async prepareSend(params: IReceiveParams): Promise<ISendInfo> {
		const puppetMxid = await this.provisioner.getMxid(params.chan.puppetId);
		const client = await this.userSync.getClient(params.user, params.chan.puppetId);
		const { mxid, created } = await this.chanSync.getMxid(params.chan, client, [puppetMxid]);

		// ensure that the intent is in the room
		const userId = await client.getUserId();
		if (this.appservice.isNamespacedUser(userId)) {
			await this.appservice.getIntentForUserId(userId).ensureRegisteredAndJoined(mxid);
		}

		// ensure our puppeted user is in the room
		const cacheKey = `${params.chan.puppetId}_${mxid}`;
		if (created) {
			// we just invited if we freshly created
			this.ghostInviteCache.set(cacheKey, true);
		}
		try {
			const cache = this.ghostInviteCache.get(cacheKey);
			if (!cache) {
				let inviteClient = await this.chanSync.getChanOp(mxid);
				if (!inviteClient) {
					inviteClient = client;
				}
				await client.inviteUser(puppetMxid, mxid);
				this.ghostInviteCache.set(cacheKey, true);
			}
		} catch (err) {
			if (err.body.errcode === "M_FORBIDDEN" && err.body.error.includes("is already in the room")) {
				log.verbose("Failed to invite user, as they are already in there");
				this.ghostInviteCache.set(cacheKey, true);
			} else {
				log.warn("Failed to invite user:", err.body);
			}
		}

		return {
			client,
			mxid,
		} as ISendInfo;
	}

	private async handleRoomEvent(roomId: string, event: any) {
		const validTypes = ["m.room.message", "m.sticker"];
		if (!validTypes.includes(event.type)) {
			return; // we don't handle this here, silently drop the event
		}
		if (this.appservice.isNamespacedUser(event.sender)) {
			return; // we don't handle things from our own namespace
		}
		log.verbose("got matrix event to pass on");
		const room = await this.chanSync.getRemoteHandler(event.room_id);
		if (!room) {
			return;
		}
		const puppetMxid = await this.provisioner.getMxid(room.puppetId);
		if (event.sender !== puppetMxid) {
			return; // this isn't a room we handle
		}
		log.info(`New message by ${event.sender} of type ${event.type} to process!`);
		let msgtype = event.content.msgtype;
		if (event.type == "m.sticker") {
			msgtype = "m.sticker";
		}
		if (msgtype === "m.emote" || msgtype === "m.text") {
			// short-circuit text stuff
			const data = {
				body: event.content.body,
				emote: msgtype === "m.emote",
			} as IMessageEvent;
			if (event.content.format) {
				data.formatted_body = event.content.formatted_body;
			}
			this.emit("message", room, data, event);
			return;
		}
		// this is a file!
		const url = `${this.config.bridge.homeserverUrl}/_matrix/media/v1/download/${event.content.url.substring("mxc://".length)}`;
		const data = {
			filename: event.content.body,
			mxc: event.content.url,
			url,
		} as IFileEvent;
		if (event.content.info) {
			data.info = event.content.info;
		}
		let emitEvent = {
			"m.image": "image",
			"m.audio": "audio",
			"m.video": "video",
			"m.sticker": "sticker",
		}[msgtype];
		if (!emitEvent) {
			emitEvent = "file";
		}
		if (this.features[emitEvent]) {
			this.emit(emitEvent, room, data, event);
			return;
		}
		if ((emitEvent === "audio" || emitEvent === "video") && this.features.file) {
			this.emit("file", room, data, event);
			return;
		}
		if (emitEvent === "sticker" && this.features.image) {
			this.emit("image", room, data, event);
			return;
		}
		if (this.features.file) {
			this.emit("file", room, data, event);
			return;
		}
		const textData = {
			body: `New ${emitEvent}: ${data.url}`,
			emote: false,
		} as IMessageEvent;
		this.emit("message", room, textData, event);
	}

	private async handleInviteEvent(roomId: string, event: any) {
		const userId = event.state_key;
		const intent = this.appservice.botIntent;
		if (userId === intent.userId) {
			intent.joinRoom(roomId);
		}
	}
}
