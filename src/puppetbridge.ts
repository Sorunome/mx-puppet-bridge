import * as fs from "fs";
import {
	Appservice,
	IAppserviceRegistration,
	Intent,
	SimpleRetryJoinStrategy,
} from "matrix-bot-sdk";
import * as uuid from "uuid/v4";
import * as yaml from "js-yaml";
import { EventEmitter } from "events";
import { ChannelSyncroniser, IRemoteChanSend, IRemoteChanReceive } from "./channelsyncroniser";
import { UserSyncroniser, IRemoteUserReceive } from "./usersyncroniser";
import { Util } from "./util";

interface ISendInfo {
	intent: Intent;
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
	files?: boolean;
	images?: boolean;
	audio?: boolean;
	videos?: boolean;
	// stickers
	stickers?: boolean;
};

export interface ITextMessage {
	body: string;
	formatted_body?: string;
};

export interface IReceiveParams {
	chan: IRemoteChanReceive;
	user: IRemoteUserReceive;
}

export class PuppetBridge extends EventEmitter {
	private appservice: Appservice;
	private chanSync: ChannelSyncroniser;
	private userSync: UserSyncroniser;

	constructor(
		private registrationPath: string,
		private features: IPuppetBridgeFeatures,
	) {
		super();
		this.chanSync = new ChannelSyncroniser(this);
		this.userSync = new UserSyncroniser(this);
	}

	generateRegistration(opts: IPuppetBridgeRegOpts) {
		if (fs.existsSync(this.registrationPath)) {
			throw new Error("Registration file already exists");
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

	public async start() {
		const registration = yaml.safeLoad(fs.readFileSync(this.registrationPath, "utf8")) as IAppserviceRegistration;
		this.appservice = new Appservice({
			bindAddress: "localhost",
			homeserverName: "localhost",
			homeserverUrl: "http://localhost",
			port: 8095,
			registration,
			joinStrategy: new SimpleRetryJoinStrategy(),
		});
		this.appservice.on("room.invite", async (roomId: string, event: any) => {
			console.log(`Got invite in ${roomId} with event ${event}`);
		});
		this.appservice.on("room.event", this.handleRoomEvent.bind(this));
		await this.appservice.begin();
	}

	public async sendFile(params: IReceiveParams, thing: string | Buffer, name?: string) {
		this.sendFileByType("m.file", params, thing, name);
	}

	public async sendVideo(params: IReceiveParams, thing: string | Buffer, name?: string) {
		this.sendFileByType("m.video", params, thing, name);
	}

	public async sendAudio(params: IReceiveParams, thing: string | Buffer, name?: string) {
		this.sendFileByType("m.audio", params, thing, name);
	}

	public async sendImage(params: IReceiveParams, thing: string | Buffer, name?: string) {
		this.sendFileByType("m.image", params, thing, name);
	}

	public async sendMessage(params: IReceiveParams, msg: string, html?: string, emote: boolean = false) {
		const { intent, mxid } = await this.prepareSend(params);
		const send = {
			msgtype: emote ? "m.emote" : "m.text",
			body: msg,
		} as any;
		if (html) {
			send.format = "org.matrix.custom.html";
			send.formatted_body = html;
		}
		await intent.underlyingClient.sendMessage(mxid, send);
	}

	private async sendFileByType(msgtype: string, params: IReceiveParams, thing: string | Buffer, name?: string) {
		const { intent, mxid } = await this.prepareSend(params);
		let buffer: Buffer;
		if (typeof thing === "string") {
			buffer = await Util.DownloadFile(thing);
		} else {
			buffer = thing;
		}
		const mimetype = Util.GetMimeType(buffer);
		const fileMxc = await intent.underlyingClient.uploadContent(
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
		await intent.sendEvent(mxid, sendData);
	}

	private async prepareSend(params: IReceiveParams): Promise<ISendInfo> {
		const mxid = await this.chanSync.getMxid(params.chan);
		const intent = await this.userSync.getIntent(params.user);

		// ensure that the intent is in the room
		await intent.ensureRegisteredAndJoined(mxid);

		return {
			intent,
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
		const room = await this.chanSync.getRemoteHandler(event.room_id);
		if (!room) {
			return; // this isn't a room we handle
		}
		console.log(`New message by ${event.sender} of type ${event.type} to process!`);
	}
}
