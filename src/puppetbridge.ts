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
} from "@sorunome/matrix-bot-sdk";
import * as uuid from "uuid/v4";
import * as yaml from "js-yaml";
import { EventEmitter } from "events";
import { EmoteSyncroniser } from "./emotesyncroniser";
import { EventSyncroniser } from "./eventsyncroniser";
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
import { DbReactionStore } from "./db/reactionstore";
import { Provisioner } from "./provisioner";
import { Store } from "./store";
import { Lock } from "./structures/lock";
import { PuppetBridgeJoinRoomStrategy } from "./joinstrategy";
import { BotProvisioner, ICommand } from "./botprovisioner";
import { ProvisioningAPI } from "./provisioningapi";
import { PresenceHandler, MatrixPresence } from "./presencehandler";
import { TypingHandler } from "./typinghandler";
import { ReactionHandler } from "./reactionhandler";
import { MatrixEventHandler } from "./matrixeventhandler";
import { RemoteEventHandler } from "./remoteeventhandler";
import { NamespaceHandler } from "./namespacehandler";
import { DelayedFunction } from "./structures/delayedfunction";
import {
	IPuppetBridgeRegOpts, IPuppetBridgeFeatures, IReceiveParams, IMessageEvent, IProtocolInformation, CreateRoomHook,
	CreateUserHook, CreateGroupHook, GetDescHook, BotHeaderMsgHook, GetDataFromStrHook, GetDmRoomIdHook, ListUsersHook,
	ListRoomsHook, ListGroupsHook, IRemoteUser, IRemoteRoom, IRemoteGroup, IPuppetData, GetUserIdsInRoomHook,
	UserExistsHook, RoomExistsHook, GroupExistsHook, ResolveRoomIdHook, IEventInfo,
} from "./interfaces";

const log = new Log("PuppetBridge");

// tslint:disable no-magic-numbers
const DEFAULT_TYPING_TIMEOUT = 30000;
const MXC_LOOKUP_LOCK_TIMEOUT = 1000 * 60;
const AVATAR_SIZE = 800;
// tslint:enable no-magic-numbers

export interface IPuppetBridgeHooks {
	createUser?: CreateUserHook;
	createRoom?: CreateRoomHook;
	createGroup?: CreateGroupHook;
	userExists?: UserExistsHook;
	roomExists?: RoomExistsHook;
	groupExists?: GroupExistsHook;
	getDesc?: GetDescHook;
	botHeaderMsg?: BotHeaderMsgHook;
	getDataFromStr?: GetDataFromStrHook;
	getDmRoomId?: GetDmRoomIdHook;
	listUsers?: ListUsersHook;
	listRooms?: ListRoomsHook;
	listGroups?: ListGroupsHook;
	getUserIdsInRoom?: GetUserIdsInRoomHook;
	resolveRoomId?: ResolveRoomIdHook;
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
		emote: string;
	};
}

export class PuppetBridge extends EventEmitter {
	public emoteSync: EmoteSyncroniser;
	public eventSync: EventSyncroniser;
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
	public provisioningAPI: ProvisioningAPI;
	public typingHandler: TypingHandler;
	public presenceHandler: PresenceHandler;
	public reactionHandler: ReactionHandler;
	public namespaceHandler: NamespaceHandler;
	private appservice: Appservice;
	private mxcLookupLock: Lock<string>;
	private matrixEventHandler: MatrixEventHandler;
	private remoteEventHandler: RemoteEventHandler;

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
				namePatterns: { user: "", userOverride: "", room: "", group: "", emote: "" },
			};
		} else {
			this.protocol = {
				id: prot.id || "unknown-protocol",
				displayname: prot.displayname || "Unknown Protocol",
				externalUrl: prot.externalUrl,
				features: prot.features || {},
				namePatterns: Object.assign({ user: "", userOverride: "", room: "", group: "", emote: "" }, prot.namePatterns),
			};
		}
		this.hooks = {};
		this.delayedFunction = new DelayedFunction();
		this.mxcLookupLock = new Lock(MXC_LOOKUP_LOCK_TIMEOUT);
	}

	/** @internal */
	public readConfig(addAppservice: boolean = true) {
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
			this.protocol.namePatterns.emote = this.config.namePatterns.emote || this.protocol.namePatterns.emote || "\\::name\\:";
		} catch (err) {
			log.error("Failed to load config file", err);
			process.exit(-1);
		}

		if (addAppservice) {
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
				registration,
				joinStrategy: new PuppetBridgeJoinRoomStrategy(new SimpleRetryJoinStrategy(), this),
			});
		}
	}

	/**
	 * Initialize the puppet bridge
	 */
	public async init() {
		this.readConfig();
		this.store = new Store(this.config.database, this);
		await this.store.init();

		this.emoteSync = new EmoteSyncroniser(this);
		this.eventSync = new EventSyncroniser(this);
		this.roomSync = new RoomSyncroniser(this);
		this.userSync = new UserSyncroniser(this);
		this.groupSync = new GroupSyncroniser(this);
		this.provisioner = new Provisioner(this);
		this.presenceHandler = new PresenceHandler(this, this.config.presence);
		this.typingHandler = new TypingHandler(this, this.protocol.features.typingTimeout || DEFAULT_TYPING_TIMEOUT);
		this.reactionHandler = new ReactionHandler(this);
		this.matrixEventHandler = new MatrixEventHandler(this);
		this.remoteEventHandler = new RemoteEventHandler(this);
		this.namespaceHandler = new NamespaceHandler(this);

		this.botProvisioner = new BotProvisioner(this);
		this.provisioningAPI = new ProvisioningAPI(this);

		// pipe matrix-bot-sdk logging int ours
		const logMap = new Map<string, Log>();
		// tslint:disable-next-line no-any
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

		// tslint:disable no-any
		LogService.setLogger({
			debug: (mod: string, args: any[]) => logFunc("debug", mod, args),
			error: (mod: string, args: any[]) => logFunc("error", mod, args),
			info: (mod: string, args: any[]) => logFunc("info", mod, args),
			warn: (mod: string, args: any[]) => logFunc("warn", mod, args),
		});
		// tslint:enable no-any
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
		const reg: IAppserviceRegistration = {
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
		};
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

	get reactionStore(): DbReactionStore {
		return this.store.reactionStore;
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
	public async start(callback?: () => Promise<void>) {
		log.info("Starting application service....");

		this.matrixEventHandler.registerAppserviceEvents();
		this.provisioningAPI.registerProvisioningAPI();
		await this.appservice.begin();
		log.info("Application service started!");
		log.info("Setting bridge user data...");
		let displayname = this.config.bridge.displayname;
		if (!displayname && this.hooks.botHeaderMsg) {
			displayname = this.hooks.botHeaderMsg();
		}
		const setBotProfile = async () => {
			try {
				if (displayname) {
					await this.appservice.botIntent.underlyingClient.setDisplayName(displayname);
				}
				if (this.config.bridge.avatarUrl) {
					await this.appservice.botIntent.underlyingClient.setAvatarUrl(this.config.bridge.avatarUrl);
				}
			} catch (err) {
				if (err.code === "ECONNREFUSED") {
					return new Promise((resolve, reject) => {
						const TIMEOUT_RETRY = 10000;
						setTimeout(async () => {
							try {
								await setBotProfile();
								resolve();
							} catch (err) {
								reject(err);
							}
						}, TIMEOUT_RETRY);
					});
				} else {
					throw err;
				}
			}
		};
		await setBotProfile();
		if (callback) {
			await callback();
		}
		log.info("Activating users...");
		const puppets = await this.provisioner.getAll();
		for (const p of puppets) {
			this.emit("puppetNew", p.puppetId, p.data);
		}
		if (this.protocol.features.presence && this.config.presence.enabled) {
			await this.presenceHandler.start();
		}
	}

	public setCreateUserHook(hook: CreateUserHook) {
		this.hooks.createUser = hook;
		if (!this.hooks.userExists) {
			this.hooks.userExists = async (user: IRemoteUser): Promise<boolean> => Boolean(await hook(user));
		}
	}

	public setCreateRoomHook(hook: CreateRoomHook) {
		this.hooks.createRoom = hook;
		if (!this.hooks.roomExists) {
			this.hooks.roomExists = async (room: IRemoteRoom): Promise<boolean> => Boolean(await hook(room));
		}
	}

	public setCreateGroupHook(hook: CreateGroupHook) {
		this.hooks.createGroup = hook;
		if (!this.hooks.groupExists) {
			this.hooks.groupExists = async (group: IRemoteGroup): Promise<boolean> => Boolean(await hook(group));
		}
	}

	public setUserExistsHook(hook: UserExistsHook) {
		this.hooks.userExists = hook;
	}

	public setRoomExistsHook(hook: RoomExistsHook) {
		this.hooks.roomExists = hook;
	}

	public setGroupExistsHook(hook: GroupExistsHook) {
		this.hooks.groupExists = hook;
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

	public setListGroupsHook(hook: ListGroupsHook) {
		this.hooks.listGroups = hook;
	}

	public setGetUserIdsInRoomHook(hook: GetUserIdsInRoomHook) {
		this.hooks.getUserIdsInRoom = hook;
	}

	public setResolveRoomIdHook(hook: ResolveRoomIdHook) {
		this.hooks.resolveRoomId = hook;
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
	public async setPuppetData(puppetId: number, data: IPuppetData) {
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
		const room = await this.namespaceHandler.createRoom(roomData);
		if (!room || room.isDirect) {
			return;
		}
		log.info(`Got request to bridge room puppetId=${room.puppetId} roomId=${room.roomId}`);
		await this.roomSync.getMxid(room);
		// tslint:disable-next-line no-floating-promises
		this.roomSync.addGhosts(room);
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
		await this.remoteEventHandler.setUserPresence(user, presence);
	}

	/**
	 * Set the status message of a remote user
	 */
	public async setUserStatus(user: IRemoteUser, status: string) {
		await this.remoteEventHandler.setUserStatus(user, status);
	}

	/**
	 * Set if a remote user is typing in a room or not
	 */
	public async setUserTyping(params: IReceiveParams, typing: boolean) {
		await this.remoteEventHandler.setUserTyping(params, typing);
	}

	/**
	 * Send a read receipt of a remote user to matrix
	 */
	public async sendReadReceipt(params: IReceiveParams) {
		await this.remoteEventHandler.sendReadReceipt(params);
	}

	/**
	 * Adds a user to a room
	 */
	public async addUser(params: IReceiveParams) {
		await this.remoteEventHandler.addUser(params);
	}

	/**
	 * Removes a user from a room
	 */
	public async removeUser(params: IReceiveParams) {
		await this.remoteEventHandler.removeUser(params);
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
		const suffix = await this.namespaceHandler.getSuffix(user.puppetId, user.userId);
		return this.appservice.getUserIdForSuffix(suffix);
	}

	/**
	 * Get the mxid for a given remote room
	 */
	public async getMxidForRoom(room: IRemoteRoom): Promise<string> {
		const roomInfo = await this.roomSync.maybeGet(room);
		if (roomInfo) {
			const client = (await this.roomSync.getRoomOp(roomInfo.mxid)) || this.botIntent.underlyingClient;
			if (client) {
				try {
					const al = (await client.getRoomStateEvent(
						roomInfo.mxid, "m.room.canonical_alias", "",
					)).alias;
					if (typeof al === "string" && al[0] === "#") {
						return al;
					}
				} catch (err) { } // do nothing
			}
		}
		const suffix = await this.namespaceHandler.getSuffix(room.puppetId, room.roomId);
		return this.appservice.getAliasForSuffix(suffix);
	}

	/**
	 * Get the URL from an MXC uri
	 */
	public getUrlFromMxc(mxc: string, width?: number, height?: number, method?: string): string {
		const baseUrl = this.config.bridge.mediaUrl || this.config.bridge.homeserverUrl;
		const mxcPath = mxc.substring("mxc://".length);
		if (!width || !height) {
			return `${baseUrl}/_matrix/media/r0/download/${mxcPath}`;
		}
		if (!method) {
			method = "crop";
		}
		const widthUri = encodeURIComponent(width);
		const heightUri = encodeURIComponent(height);
		method = encodeURIComponent(method);
		return `${baseUrl}/_matrix/media/r0/thumbnail/${mxcPath}?width=${widthUri}&height=${heightUri}&method=${method}`;
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
		if (info && (info.name || info.avatarMxc)) {
			if (info.avatarMxc) {
				info.avatarUrl = this.getUrlFromMxc(info.avatarMxc, AVATAR_SIZE, AVATAR_SIZE, "scale");
			}
			return info;
		}
		// okay, let's see if we can fetch the profile
		try {
			const ret = await this.botIntent.underlyingClient.getUserProfile(puppetMxid);
			const p = await this.store.puppetStore.getOrCreateMxidInfo(puppetMxid);
			p.name = ret.displayname || null;
			if (ret.avatar_url) {
				p.avatarMxc = ret.avatar_url;
				p.avatarUrl = this.getUrlFromMxc(ret.avatar_url, AVATAR_SIZE, AVATAR_SIZE, "scale");
			} else {
				p.avatarMxc = null;
				p.avatarUrl = null;
			}
			await this.store.puppetStore.setMxidInfo(p);
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
		await this.remoteEventHandler.sendFileByType("detect", params, thing, name);
	}

	/**
	 * Send an m.file to matrix
	 */
	public async sendFile(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.remoteEventHandler.sendFileByType("m.file", params, thing, name);
	}

	/**
	 * Send an m.video to matrix
	 */
	public async sendVideo(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.remoteEventHandler.sendFileByType("m.video", params, thing, name);
	}

	/**
	 * Send an m.audio to matrix
	 */
	public async sendAudio(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.remoteEventHandler.sendFileByType("m.audio", params, thing, name);
	}

	/**
	 * Send an m.image to matrix
	 */
	public async sendImage(params: IReceiveParams, thing: string | Buffer, name?: string) {
		await this.remoteEventHandler.sendFileByType("m.image", params, thing, name);
	}

	/**
	 * Send a message to matrix
	 */
	public async sendMessage(params: IReceiveParams, opts: IMessageEvent) {
		await this.remoteEventHandler.sendMessage(params, opts);
	}

	/**
	 * Send an edit to matrix
	 */
	public async sendEdit(params: IReceiveParams, eventId: string, opts: IMessageEvent, ix: number = 0) {
		await this.remoteEventHandler.sendEdit(params, eventId, opts, ix);
	}

	/**
	 * Send a redaction to matrix
	 */
	public async sendRedact(params: IReceiveParams, eventId: string) {
		await this.remoteEventHandler.sendRedact(params, eventId);
	}

	/**
	 * Send a reply to matrix
	 */
	public async sendReply(params: IReceiveParams, eventId: string, opts: IMessageEvent) {
		await this.remoteEventHandler.sendReply(params, eventId, opts);
	}

	/**
	 * Send a reaction to matrix
	 */
	public async sendReaction(params: IReceiveParams, eventId: string, reaction: string) {
		await this.remoteEventHandler.sendReaction(params, eventId, reaction);
	}

	/**
	 * Remove a reaction from matrix
	 */
	public async removeReaction(params: IReceiveParams, eventId: string, reaction: string) {
		await this.remoteEventHandler.removeReaction(params, eventId, reaction);
	}

	/**
	 * Remove all reactions from a certain event
	 */
	public async removeAllReactions(params: IReceiveParams, eventId: string) {
		await this.remoteEventHandler.removeAllReactions(params, eventId);
	}

	/**
	 * Wraps a matrix client to use the mediaUrl endpoint instead
	 */
	public async getMediaClient(client: MatrixClient): Promise<MatrixClient> {
		if (!this.config.bridge.mediaUrl) {
			return client;
		}
		const mediaClient = new MatrixClient(this.config.bridge.mediaUrl, client.accessToken);
		mediaClient.metrics = client.metrics;
		const userId = await client.getUserId();
		if (this.appservice.isNamespacedUser(userId) && userId !== this.appservice.botUserId) {
			mediaClient.impersonateUserId(userId);
		}
		return mediaClient;
	}

	/**
	 * Upload content to matrix, automatically de-duping it
	 */
	public async uploadContent(
		client: MatrixClient | null,
		thing: string | Buffer,
		mimetype?: string,
		filename?: string,
	): Promise<string> {
		let buffer: Buffer;
		const locks: string[] = [];
		try {
			if (!client) {
				client = this.botIntent.underlyingClient;
			}
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
			const mediaClient = await this.getMediaClient(client);
			const mxcUrl = await mediaClient.uploadContent(buffer, mimetype, filename);
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

	/**
	 * Redacts an event and re-tries as room OP
	 */
	public async redactEvent(client: MatrixClient, roomId: string, eventId: string) {
		try {
			await client.redactEvent(roomId, eventId);
		} catch (err) {
			if (err.body.errcode === "M_FORBIDDEN") {
				const opClient = await this.roomSync.getRoomOp(roomId);
				if (!opClient) {
					throw err;
				}
				await opClient.redactEvent(roomId, eventId);
			} else {
				throw err;
			}
		}
	}

	public async getEventInfo(
		roomId: string | IRemoteRoom,
		eventId: string,
		client?: MatrixClient,
	): Promise<IEventInfo | null> {
		let sender: string | undefined;
		if (typeof roomId !== "string") {
			const maybeRoomId = await this.roomSync.maybeGetMxid(roomId);
			if (!maybeRoomId) {
				return null;
			}
			if (roomId.puppetId !== -1) {
				try {
					sender = await this.provisioner.getMxid(roomId.puppetId);
				} catch {}
			}
			eventId = (await this.eventSync.getMatrix(roomId, eventId))[0];
			roomId = maybeRoomId;
		}
		return this.matrixEventHandler.getEventInfo(roomId, eventId, client, sender);
	}
}
