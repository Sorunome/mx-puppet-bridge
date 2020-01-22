/*
Copyright 2019, 2020 mx-puppet-bridge
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

import * as fs from "fs";
import {
	Appservice,
	IAppserviceRegistration,
	Intent,
	MatrixClient,
	SimpleRetryJoinStrategy,
	LogService,
} from "matrix-bot-sdk";
import * as uuid from "uuid/v4";
import * as yaml from "js-yaml";
import { EventEmitter } from "events";
import { RoomSyncroniser } from "./roomsyncroniser";
import { UserSyncroniser } from "./usersyncroniser";
import { GroupSyncroniser } from "./groupsyncroniser";
import { Config } from "./config";
import { Util } from "./util";
import { Log } from "./log";
import { DbUserStore } from "./db/userstore";
import { DbRoomStore } from "./db/roomstore";
import { DbGroupStore } from "./db/groupstore";
import { DbPuppetStore, IMxidInfo } from "./db/puppetstore";
import { DbEventStore } from "./db/eventstore";
import { Provisioner } from "./provisioner";
import { Store } from "./store";
import { Lock } from "./structures/lock";
import { TimedCache } from "./structures/timedcache";
import { PuppetBridgeJoinRoomStrategy } from "./joinstrategy";
import { BotProvisioner, ICommand } from "./botprovisioner";
import { PresenceHandler, MatrixPresence } from "./presencehandler";
import { TypingHandler } from "./typinghandler";
import { MatrixEventHandler } from "./matrixeventhandler";
import { DelayedFunction } from "./structures/delayedfunction";
import {
	IPuppetBridgeRegOpts, IPuppetBridgeFeatures, IReceiveParams, IMessageEvent, IFileEvent, RetDataFn,
	IRetData, IRetList, IProtocolInformation, CreateRoomHook, CreateUserHook, CreateGroupHook, GetDescHook,
	BotHeaderMsgHook, GetDataFromStrHook, GetDmRoomIdHook, ListUsersHook, ListRoomsHook, IRemoteUser, IRemoteRoom,
	IRemoteGroup,
} from "./interfaces";

const log = new Log("PuppetBridge");

// tslint:disable no-magic-numbers
const PUPPET_INVITE_CACHE_LIFETIME = 1000 * 60 * 60 * 24;
const GHOST_PUPPET_LEAVE_TIMEOUT = 1000 * 60 * 60;
const DEFAULT_TYPING_TIMEOUT = 30000;
const MXC_LOOKUP_LOCK_TIMEOUT = 1000 * 60;
// tslint:enable no-magic-numbers

interface ISendInfo {
	client: MatrixClient;
	mxid: string;
}

export interface IPuppetBridgeHooks {
	createUser?: CreateUserHook;
	createRoom?: CreateRoomHook;
	createGroup?: CreateGroupHook;
	getDesc?: GetDescHook;
	botHeaderMsg?: BotHeaderMsgHook;
	getDataFromStr?: GetDataFromStrHook;
	getDmRoomId?: GetDmRoomIdHook;
	listUsers?: ListUsersHook;
	listRooms?: ListRoomsHook;
}

interface ISetProtocolInformation extends IProtocolInformation {
	id: string;
	displayname: string;
	features: IPuppetBridgeFeatures;
	namePatterns: {
		user: string;
		userOverride: string;
		room: string;
		group: string;
	};
}

export class PuppetBridge extends EventEmitter {
	public roomSync: RoomSyncroniser;
	public userSync: UserSyncroniser;
	public groupSync: GroupSyncroniser;
	public hooks: IPuppetBridgeHooks;
	public config: Config;
	public provisioner: Provisioner;
	public store: Store;
	public protocol: ISetProtocolInformation;
	public delayedFunction: DelayedFunction;
	public botProvisioner: BotProvisioner;
	private appservice: Appservice;
	private ghostInviteCache: TimedCache<string, boolean>;
	private presenceHandler: PresenceHandler;
	private typingHandler: TypingHandler;
	private mxcLookupLock: Lock<string>;
	private matrixEventHandler: MatrixEventHandler;

	constructor(
		private registrationPath: string,
		private configPath: string,
		prot?: IProtocolInformation,
	) {
		super();
		if (!prot) {
			this.protocol = {
				id: "unknown-protocol",
				displayname: "Unknown Protocol",
				features: {},
				namePatterns: { user: "", userOverride: "", room: "", group: "" },
			};
		} else {
			this.protocol = {
				id: prot.id || "unknown-protocol",
				displayname: prot.displayname || "Unknown Protocol",
				externalUrl: prot.externalUrl,
				features: prot.features || {},
				namePatterns: Object.assign({ user: "", userOverride: "", room: "", group: "" }, prot.namePatterns),
			};
		}
		this.ghostInviteCache = new TimedCache(PUPPET_INVITE_CACHE_LIFETIME);
		this.hooks = {} as IPuppetBridgeHooks;
		this.delayedFunction = new DelayedFunction();
		this.mxcLookupLock = new Lock(MXC_LOOKUP_LOCK_TIMEOUT);
	}

	/** @internal */
	public readConfig() {
		try {
			this.config = new Config();
			this.config.applyConfig(yaml.safeLoad(fs.readFileSync(this.configPath, "utf8")));
			Log.Configure(this.config.logging);
			// apply name patterns
			this.protocol.namePatterns.user = this.config.namePatterns.user || this.protocol.namePatterns.user || ":name";
			this.protocol.namePatterns.userOverride = this.config.namePatterns.userOverride ||
				this.protocol.namePatterns.userOverride || ":name";
			this.protocol.namePatterns.room = this.config.namePatterns.room || this.protocol.namePatterns.room || ":name";
			this.protocol.namePatterns.group = this.config.namePatterns.group || this.protocol.namePatterns.group || ":name";
		} catch (err) {
			log.error("Failed to load config file", err);
			process.exit(-1);
		}
	}

	/**
	 * Initialize the puppet bridge
	 */
	public async init() {
		this.readConfig();
		this.store = new Store(this.config.database);
		await this.store.init();

		this.roomSync = new RoomSyncroniser(this);
		this.userSync = new UserSyncroniser(this);
		this.groupSync = new GroupSyncroniser(this);
		this.provisioner = new Provisioner(this);
		this.presenceHandler = new PresenceHandler(this);
		this.typingHandler = new TypingHandler(this, this.protocol.features.typingTimeout || DEFAULT_TYPING_TIMEOUT);
		this.matrixEventHandler = new MatrixEventHandler(this);

		this.botProvisioner = new BotProvisioner(this);

		// pipe matrix-bot-sdk logging int ours
		const logMap = new Map<string, Log>();
		const logFunc = (level: string, module: string, args: any[]) => {
			if (!Array.isArray(args)) {
				args = [args];
			}
			if (args.find((s) => s.includes && s.includes("M_USER_IN_USE"))) {
				// Spammy logs begon
				return;
			}
			let mod = "bot-sdk-" + module;
			const modParts = module.match(/^(\S+)\s(.*)/);
			const MOD_PART_MODULE = 1;
			const MOD_PART_EXTRA = 2;
			if (modParts) {
				if (modParts[MOD_PART_EXTRA]) {
					args.unshift(modParts[MOD_PART_EXTRA]);
				}
				mod = "bot-sdk-" + modParts[MOD_PART_MODULE];
			}
			let logger = logMap.get(mod);
			if (!logger) {
				logger = new Log(mod);
				logMap.set(mod, logger);
			}
			logger[level](...args);
		};

		LogService.setLogger({
			debug: (mod: string, args: any[]) => logFunc("debug", mod, args),
			error: (mod: string, args: any[]) => logFunc("error", mod, args),
			info: (mod: string, args: any[]) => logFunc("info", mod, args),
			warn: (mod: string, args: any[]) => logFunc("warn", mod, args),
		});
	}

	/**
	 * Generate a registration file
	 */
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
				users: [{
					exclusive: true,
					regex: `@${opts.prefix}.*`,
				}],
				rooms: [ ],
				aliases: [{
					exclusive: true,
					regex: `#${opts.prefix}.*`,
				}],
			},
			protocols: [ ],
			rate_limited: false,
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

	get roomStore(): DbRoomStore {
		return this.store.roomStore;
	}

	get groupStore(): DbGroupStore {
		return this.store.groupStore;
	}

	get puppetStore(): DbPuppetStore {
		return this.store.puppetStore;
	}

	get eventStore(): DbEventStore {
		return this.store.eventStore;
	}

	get Config(): Config {
		return this.config;
	}

	get groupSyncEnabled(): boolean {
		return this.hooks.createGroup && this.config.bridge.enableGroupSync ? true : false;
	}

	/**
	 * Start the puppeting bridge
	 */
	public async start() {
		log.info("Starting application service....");
		let registration: IAppserviceRegistration | null = null;
		try {
			registration = yaml.safeLoad(fs.readFileSync(this.registrationPath, "utf8")) as IAppserviceRegistration;
		} catch (err) {
			log.error("Failed to load registration file", err);
			process.exit(-1);
		}
		if (!registration) {
			log.error("Registration file seems blank");
			process.exit(-1);
		}
		this.appservice = new Appservice({
			bindAddress: this.config.bridge.bindAddress,
			homeserverName: this.config.bridge.domain,
			homeserverUrl: this.config.bridge.homeserverUrl,
			port: this.config.bridge.port,
			registration: registration as IAppserviceRegistration,
			joinStrategy: new PuppetBridgeJoinRoomStrategy(new SimpleRetryJoinStrategy(), this),
		});
		this.matrixEventHandler.registerAppserviceEvents();
		await this.appservice.begin();
		log.info("Application service started!");
		log.info("Setting bridge user data...");
		let displayname = this.config.bridge.displayname;
		if (!displayname && this.hooks.botHeaderMsg) {
			displayname = this.hooks.botHeaderMsg();
		}
		if (displayname) {
			await this.appservice.botIntent.underlyingClient.setDisplayName(displayname);
		}
		if (this.config.bridge.avatarUrl) {
			await this.appservice.botIntent.underlyingClient.setAvatarUrl(this.config.bridge.avatarUrl);
		}
		log.info("Activating users...");
		const puppets = await this.provisioner.getAll();
		for (const p of puppets) {
			this.emit("puppetNew", p.puppetId, p.data);
		}
		if (this.protocol.features.presence && this.config.presence.enabled) {
			await this.presenceHandler.start(this.config.presence.interval);
		}
	}

	public setCreateUserHook(hook: CreateUserHook) {
		this.hooks.createUser = hook;
	}

	public setCreateRoomHook(hook: CreateRoomHook) {
		this.hooks.createRoom = hook;
	}

	public setCreateGroupHook(hook: CreateGroupHook) {
		this.hooks.createGroup = hook;
	}

	public setGetDescHook(hook: GetDescHook) {
		this.hooks.getDesc = hook;
	}

	public setBotHeaderMsgHook(hook: BotHeaderMsgHook) {
		this.hooks.botHeaderMsg = hook;
	}

	public setGetDataFromStrHook(hook: GetDataFromStrHook) {
		this.hooks.getDataFromStr = hook;
	}

	public setGetDmRoomIdHook(hook: GetDmRoomIdHook) {
		this.hooks.getDmRoomId = hook;
	}

	public setListUsersHook(hook: ListUsersHook) {
		this.hooks.listUsers = hook;
	}

	public setListRoomsHook(hook: ListRoomsHook) {
		this.hooks.listRooms = hook;
	}

	/**
	 * Set what the remote user ID of a puppet is
	 */
	public async setUserId(puppetId: number, userId: string) {
		await this.provisioner.setUserId(puppetId, userId);
	}

	/**
	 * Set (store) the data associated with a puppet, if you change it
	 */
	public async setPuppetData(puppetId: number, data: any) {
		await this.provisioner.setData(puppetId, data);
	}

	/**
	 * Update a given remote users profile
	 */
	public async updateUser(user: IRemoteUser) {
		log.verbose("Got request to update a user");
		await this.userSync.getClient(user);
	}

	/**
	 * Update the information on a remote room
	 */
	public async updateRoom(room: IRemoteRoom) {
		log.verbose("Got request to update a room");
		await this.roomSync.getMxid(room, undefined, undefined, false);
	}

	/**
	 * Update the information on a remote group
	 */
	public async updateGroup(group: IRemoteGroup) {
		if (this.groupSyncEnabled) {
			log.verbose("Got request to update a group");
			await this.groupSync.getMxid(group, false);
		}
	}

	/**
	 * Trigger a remote room to be bridged
	 */
	public async bridgeRoom(roomData: IRemoteRoom) {
		if (!this.hooks.createRoom) {
			return;
		}

		// check if this is a valid room at all
		const room = await this.hooks.createRoom(roomData);
		if (!room || roomData.puppetId !== room.puppetId || roomData.roomId !== room.roomId || room.isDirect) {
			return;
		}
		log.info(`Got request to bridge room puppetId=${room.puppetId} roomId=${room.roomId}`);
		// check if the corresponding puppet exists
		const puppet = await this.provisioner.get(room.puppetId);
		if (!puppet) {
			return;
		}
		const invites = [puppet.puppetMxid];
		await this.roomSync.getMxid(room, undefined, invites);
	}

	/**
	 * Unbridge a room, given an mxid
	 */
	public async unbridgeRoomByMxid(mxid: string) {
		const room = await this.roomSync.getPartsFromMxid(mxid);
		await this.unbridgeRoom(room);
	}

	/**
	 * Unbridge a remote room
	 */
	public async unbridgeRoom(room: IRemoteRoom | null) {
		if (!room) {
			return;
		}
		log.info(`Got request to unbridge room puppetId=${room.puppetId} roomId=${room.roomId}`);
		await this.roomSync.delete(room, true);
	}

	/**
	 * Set presence of a remote user
	 */
	public async setUserPresence(user: IRemoteUser, presence: MatrixPresence) {
		if (this.protocol.features.presence && this.config.presence.enabled) {
			log.verbose(`Setting user presence for userId=${user.userId} to ${presence}`);
			const client = await this.userSync.maybeGetClient(user);
			if (!client) {
				return;
			}
			const userId = await client.getUserId();
			this.presenceHandler.set(userId, presence);
		}
	}

	/**
	 * Set the status message of a remote user
	 */
	public async setUserStatus(user: IRemoteUser, status: string) {
		if (this.protocol.features.presence && this.config.presence.enabled) {
			log.verbose(`Setting user status for userId=${user.userId} to ${status}`);
			const client = await this.userSync.maybeGetClient(user);
			if (!client) {
				return;
			}
			const userId = await client.getUserId();
			this.presenceHandler.setStatus(userId, status);
		}
	}

	/**
	 * Set if a remote user is typing in a room or not
	 */
	public async setUserTyping(params: IReceiveParams, typing: boolean) {
		log.verbose(`Setting user typing for userId=${params.user.userId} in roomId=${params.room.roomId} to ${typing}`);
		const ret = await this.maybePrepareSend(params);
		if (!ret) {
			return;
		}
		await this.typingHandler.set(await ret.client.getUserId(), ret.mxid, typing);
	}

	/**
	 * Send a read receipt of a remote user to matrix
	 */
	public async sendReadReceipt(params: IReceiveParams) {
		log.verbose(`Got request to send read indicators for userId=${params.user.userId} in roomId=${params.room.roomId}`);
		const ret = await this.maybePrepareSend(params);
		if (!ret || !params.eventId) {
			return;
		}
		const origEvents = await this.eventStore.getMatrix(params.room.puppetId, params.eventId);
		for (const origEvent of origEvents) {
			await ret.client.sendReadReceipt(ret.mxid, origEvent);
		}
	}

	/**
	 * Get the mxid for a given remote user
	 */
	public async getMxidForUser(user: IRemoteUser, doublePuppetCheck: boolean = true): Promise<string> {
		if (doublePuppetCheck) {
			const puppetData = await this.provisioner.get(user.puppetId);
			if (puppetData && puppetData.userId === user.userId) {
				return puppetData.puppetMxid;
			}
		}
		return this.appservice.getUserIdForSuffix(`${user.puppetId}_${Util.str2mxid(user.userId)}`);
	}

	/**
	 * Get the mxid for a given remote room
	 */
	public async getMxidForRoom(room: IRemoteRoom): Promise<string> {
		return this.appservice.getAliasForSuffix(`${room.puppetId}_${Util.str2mxid(room.roomId)}`);
	}

	/**
	 * Get the URL from an MXC uri
	 */
	public getUrlFromMxc(mxc: string): string {
		return `${this.config.bridge.homeserverUrl}/_matrix/media/v1/download/${mxc.substring("mxc://".length)}`;
	}

	/**
	 * Get the info (name, avatar) of the the specified puppet
	 */
	public async getPuppetMxidInfo(puppetId: number): Promise<IMxidInfo | null> {
		let puppetMxid = "";
		try {
			puppetMxid = await this.provisioner.getMxid(puppetId);
		} catch (err) {
			return null;
		}
		const info = await this.store.puppetStore.getMxidInfo(puppetMxid);
		if (info) {
			if (info.avatarMxc) {
				info.avatarUrl = this.getUrlFromMxc(info.avatarMxc);
			}
			return info;
		}
		// okay, let's see if we can fetch the profile
		try {
			const ret = await this.botIntent.underlyingClient.getUserProfile(puppetMxid);
			const p = {
				puppetMxid,
				name: ret.displayname || null,
				avatarMxc: ret.avatar_url,
				token: null,
			} as IMxidInfo;
			await this.store.puppetStore.setMxidInfo(p);
			if (p.avatarMxc) {
				p.avatarUrl = this.getUrlFromMxc(p.avatarMxc);
			}
			return p;
		} catch (err) {
			return null;
		}
	}

	/**
	 * Send a status message either to the status message room or to a specified room
	 */
	public async sendStatusMessage(puppetId: number | IRemoteRoom, msg: string) {
		await this.botProvisioner.sendStatusMessage(puppetId, msg);
	}

	/**
	 * Registers a custom command with the bot provisioner
	 */
	public registerCommand(name: string, command: ICommand) {
		this.botProvisioner.registerCommand(name, command);
	}

	/**
	 * Send a file to matrix, auto-detect its type
	 */
	public async sendFileDetect(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("detect", params, thing, name);
	}

	/**
	 * Send an m.file to matrix
	 */
	public async sendFile(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.file", params, thing, name);
	}

	/**
	 * Send an m.video to matrix
	 */
	public async sendVideo(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.video", params, thing, name);
	}

	/**
	 * Send an m.audio to matrix
	 */
	public async sendAudio(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.audio", params, thing, name);
	}

	/**
	 * Send an m.image to matrix
	 */
	public async sendImage(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.sendFileByType("m.image", params, thing, name);
	}

	/**
	 * Send a message to matrix
	 */
	public async sendMessage(params: IReceiveParams, opts: IMessageEvent) {
		log.verbose(`Received message to send`);
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
			source: "remote",
		} as any;
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	/**
	 * Send an edit to matrix
	 */
	public async sendEdit(params: IReceiveParams, eventId: string, opts: IMessageEvent, ix: number = 0) {
		log.verbose(`Received edit to send`);
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const origEvents = await this.eventStore.getMatrix(params.room.puppetId, eventId);
		if (ix < 0) {
			// negative indexes are from the back
			ix = origEvents.length + ix;
		}
		if (ix >= origEvents.length) {
			// sanity check on the index
			ix = 0;
		}
		const origEvent = origEvents[ix];
		const send = {
			"msgtype": msgtype,
			"body": `* ${opts.body}`,
			"source": "remote",
			"m.new_content": {
				body: opts.body,
				msgtype,
			},
		} as any;
		if (origEvent) {
			send["m.relates_to"] = {
				event_id: origEvent,
				rel_type: "m.replace",
			};
		} else {
			log.warn("Couldn't find event, sending as normal message...");
		}
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = `* ${opts.formattedBody}`;
			send["m.new_content"].format = "org.matrix.custom.html";
			send["m.new_content"].formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	/**
	 * Send a redaction to matrix
	 */
	public async sendRedact(params: IReceiveParams, eventId: string) {
		log.verbose("Received redact to send");
		const { client, mxid } = await this.prepareSend(params);
		const origEvents = await this.eventStore.getMatrix(params.room.puppetId, eventId);
		for (const origEvent of origEvents) {
			await client.redactEvent(mxid, origEvent);
		}
	}

	/**
	 * Send a reply to matrix
	 */
	public async sendReply(params: IReceiveParams, eventId: string, opts: IMessageEvent) {
		log.verbose(`Received reply to send`);
		const { client, mxid } = await this.prepareSend(params);
		let msgtype = "m.text";
		if (opts.emote) {
			msgtype = "m.emote";
		} else if (opts.notice) {
			msgtype = "m.notice";
		}
		const origEvents = await this.eventStore.getMatrix(params.room.puppetId, eventId);
		const origEvent = origEvents[0];
		const send = {
			msgtype,
			body: opts.body,
			source: "remote",
		} as any;
		if (origEvent) {
			send["m.relates_to"] = {
				"m.in_reply_to": {
					event_id: origEvent,
				},
			};
		} else {
			log.warn("Couldn't find event, sending as normal message...");
		}
		if (opts.formattedBody) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = opts.formattedBody;
		}
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, send);
		if (matrixEventId && params.eventId) {
			await this.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	/**
	 * Send a reaction to matrix
	 */
	public async sendReaction(params: IReceiveParams, eventId: string, reaction: string) {
		log.verbose(`Received reaction to send`);
		const { client, mxid } = await this.prepareSend(params);
		const origEvents = await this.eventStore.getMatrix(params.room.puppetId, eventId);
		const origEvent = origEvents[0];
		if (!origEvent) {
			return; // nothing to do
		}
		const send = {
			"source": "remote",
			"m.relates_to": {
				rel_type: "m.annotation",
				event_id: origEvent,
				key: reaction,
			},
		} as any;
		if (params.externalUrl) {
			send.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendEvent(mxid, "m.reaction", send);
		if (matrixEventId && params.eventId) {
			await this.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	/**
	 * Upload content to matrix, automatically de-duping it
	 */
	public async uploadContent(
		client: MatrixClient,
		thing: string | Buffer,
		mimetype?: string,
		filename?: string,
	): Promise<string> {
		let buffer: Buffer;
		const locks: string[] = [];
		try {
			if (typeof thing === "string") {
				await this.mxcLookupLock.wait(thing);
				locks.push(thing);
				this.mxcLookupLock.set(thing);
				const maybeMxcUrl = await this.store.getFileMxc(thing);
				if (maybeMxcUrl) {
					return maybeMxcUrl;
				}
				if (!filename) {
					const matches = thing.match(/\/([^\.\/]+\.[a-zA-Z0-9]+)(?:$|\?)/);
					if (matches) {
						filename = matches[1];
					}
				}
				buffer = await Util.DownloadFile(thing);
			} else {
				buffer = thing;
			}
			{
				const hash = Util.HashBuffer(buffer);
				await this.mxcLookupLock.wait(hash);
				locks.push(hash);
				this.mxcLookupLock.set(hash);
				const maybeMxcUrl = await this.store.getFileMxc(hash);
				if (maybeMxcUrl) {
					return maybeMxcUrl;
				}
			}
			if (!filename) {
				filename = "file";
			}
			if (!mimetype) {
				mimetype = Util.GetMimeType(buffer);
			}
			const mxcUrl = await client.uploadContent(buffer, mimetype, filename);
			if (typeof thing === "string") {
				await this.store.setFileMxc(thing, mxcUrl, filename);
			}
			await this.store.setFileMxc(buffer, mxcUrl, filename);
			// we need to remove all locks
			for (const lock of locks) {
				this.mxcLookupLock.release(lock);
			}
			return mxcUrl;
		} catch (err) {
			log.error("Failed to upload media", err.error || err.body || err);
			// we need to remove all locks
			for (const lock of locks) {
				this.mxcLookupLock.release(lock);
			}
			throw err;
		}
	}

	private async sendFileByType(msgtype: string, params: IReceiveParams, thing: string | Buffer, name?: string) {
		log.verbose(`Received file to send. thing=${typeof thing === "string" ? thing : "<Buffer>"} name=${name}`);
		if (!name) {
			name = "remote_file";
		}
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
		const fileMxc = await this.uploadContent(
			client,
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
			source: "remote",
		} as any;
		if (typeof thing === "string") {
			sendData.external_url = thing;
		}
		if (params.externalUrl) {
			sendData.external_url = params.externalUrl;
		}
		const matrixEventId = await client.sendMessage(mxid, sendData);
		if (matrixEventId && params.eventId) {
			await this.eventStore.insert(params.room.puppetId, matrixEventId, params.eventId);
		}
	}

	private async maybePrepareSend(params: IReceiveParams): Promise<ISendInfo | null> {
		log.verbose(`Maybe preparing send parameters`, params);
		const mxid = await this.roomSync.maybeGetMxid(params.room);
		if (!mxid) {
			return null;
		}
		const client = await this.userSync.maybeGetClient(params.user);
		if (!client) {
			return null;
		}
		return { client, mxid };
	}

	private async prepareSend(params: IReceiveParams): Promise<ISendInfo> {
		log.verbose(`Preparing send parameters`, params);
		const puppetData = await this.provisioner.get(params.room.puppetId);
		const puppetMxid = puppetData ? puppetData.puppetMxid : "";
		const client = await this.userSync.getClient(params.user);
		const userId = await client.getUserId();
		// we could be the one creating the room, no need to invite ourself
		const invites: string[] = [];
		if (userId !== puppetMxid) {
			invites.push(puppetMxid);
		} else {
			// else we need the bot client in order to be able to receive matrix messages
			invites.push(await this.botIntent.underlyingClient.getUserId());
		}
		const { mxid, created } = await this.roomSync.getMxid(params.room, client, invites);

		// ensure that the intent is in the room
		if (this.appservice.isNamespacedUser(userId)) {
			log.silly("Joining ghost to room...");
			const intent = this.appservice.getIntentForUserId(userId);
			await intent.ensureRegisteredAndJoined(mxid);
			// if the ghost was ourself, leave it again
			if (puppetData && puppetData.userId === params.user.userId) {
				const delayedKey = `${userId}_${mxid}`;
				this.delayedFunction.set(delayedKey, async () => {
					await this.roomSync.maybeLeaveGhost(mxid, userId);
				}, GHOST_PUPPET_LEAVE_TIMEOUT);
			}
			// set the correct m.room.member override if the room just got created
			if (created) {
				log.verbose("Maybe applying room membership overrides");
				await this.userSync.setRoomOverride(params.user, params.room.roomId, null, client);
			}
		}

		// ensure our puppeted user is in the room
		const cacheKey = `${params.room.puppetId}_${mxid}`;
		try {
			const cache = this.ghostInviteCache.get(cacheKey);
			if (!cache) {
				let inviteClient = await this.roomSync.getRoomOp(mxid);
				if (!inviteClient) {
					inviteClient = client;
				}
				// we can't really invite ourself...
				if (await inviteClient.getUserId() !== puppetMxid) {
					// we just invited if we created, don't try to invite again
					if (!created) {
						log.silly("Inviting puppet to room...");
						await client.inviteUser(puppetMxid, mxid);
					}
					this.ghostInviteCache.set(cacheKey, true);

					// let's try to also join the room, if we use double-puppeting
					const puppetClient = await this.userSync.getPuppetClient(params.room.puppetId);
					if (puppetClient) {
						log.silly("Joining the room...");
						await puppetClient.joinRoom(mxid);
					}
				}
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
}
