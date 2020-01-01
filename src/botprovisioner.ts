import { PuppetBridge, RetDataFn, IRetData } from "./puppetbridge";
import { Provisioner } from "./provisioner";
import { Log } from "./log";
import { TimedCache } from "./structures/timedcache";
import * as MarkdownIt from "markdown-it";

const md = new MarkdownIt();

// tslint:disable-next-line:no-magic-numbers
const MESSAGE_COLLECT_TIMEOUT = 1000 * 60;
const MAX_MSG_SIZE = 4000;

const log = new Log("BotProvisioner");

interface IFnCollect {
	fn: RetDataFn;
	puppetId: number;
}

export type SendMessageFn = (s: string) => Promise<void>;
export type PidCommandFn = (pid: number, param: string, sendMessage: SendMessageFn) => Promise<void>;
export type FullCommandFn = (sender: string, param: string, sendMessage: SendMessageFn) => Promise<void>;

export interface ICommand {
	fn: PidCommandFn | FullCommandFn;
	help: string;
	withPid?: boolean;
}

export class BotProvisioner {
	private provisioner: Provisioner;
	private fnCollectListeners: TimedCache<string, IFnCollect>;
	private commands: {[key: string]: ICommand} = {};
	constructor(
		private bridge: PuppetBridge,
	) {
		this.provisioner = this.bridge.provisioner;
		this.fnCollectListeners = new TimedCache(MESSAGE_COLLECT_TIMEOUT);
		this.registerDefaultCommands();
	}

	public async processEvent(event: any) {
		if (event.type !== "m.room.message") {
			return; // not ours to handle
		}
		const roomId = event.room_id;
		const sender = event.sender;
		// update the status room entry, if needed
		const senderInfo = await this.bridge.puppetStore.getOrCreateMxidInfo(sender);
		if (senderInfo.statusRoom !== roomId) {
			senderInfo.statusRoom = roomId;
			await this.bridge.puppetStore.setMxidInfo(senderInfo);
		}
		// parse the argument and parameters of the message
		const [, arg, param] = event.content.body.split(/([^ ]*)(?: (.*))?/);
		log.info(`Got message to process with arg=${arg}`);
		const fnCollect = this.fnCollectListeners.get(sender);
		if (this.bridge.hooks.botHeaderMsg && !fnCollect) {
			await this.sendMessage(roomId, this.bridge.hooks.botHeaderMsg());
		}
		switch (fnCollect ? "link" : arg) {
			case "relink":
			case "link": {
				let puppetId = -1;
				let parseParam = param;
				if (fnCollect) {
					puppetId = fnCollect.puppetId;
					parseParam = event.content.body;
				} else if (arg === "relink") {
					const [, pidStr, p] = (param || "").split(/([^ ]*)(?: (.*))?/);
					const pid = parseInt(pidStr, 10);
					// now we need to check if that pid is ours
					const d = await this.provisioner.get(pid);
					if (!d || d.puppetMxid !== sender) {
						await this.sendMessage(roomId, "ERROR: PuppetID not found");
						break;
					}
					puppetId = pid;
					parseParam = p;
				}
				if (!parseParam) {
					parseParam = "";
				}
				if (!this.provisioner.canCreate(sender)) {
					await this.sendMessage(roomId, "ERROR: You don't have permission to use this bridge");
					break;
				}
				if (!this.bridge.hooks.getDataFromStr) {
					await this.sendMessage(roomId, "ERROR: The bridge is still starting up, please try again shortly");
					break;
				}
				let retData: IRetData;
				if (fnCollect) {
					retData = await fnCollect.fn(event.content.body);
					this.fnCollectListeners.delete(sender);
				} else {
					retData = await this.bridge.hooks.getDataFromStr(parseParam);
				}
				if (!retData.success) {
					if (retData.fn) {
						await this.sendMessage(roomId, `${retData.error}`);
						this.fnCollectListeners.set(sender, {
							fn: retData.fn,
							puppetId: -1,
						});
						break;
					}
					await this.sendMessage(roomId, `ERROR: ${retData.error}`);
					break;
				}
				if (puppetId === -1) {
					// we need to create a new link
					puppetId = await this.provisioner.new(sender, retData.data, retData.userId);
					await this.sendMessage(roomId, `Created new link with ID ${puppetId}`);
				} else {
					// we need to update an existing link
					await this.provisioner.update(sender, puppetId, retData.data, retData.userId);
					await this.sendMessage(roomId, `Updated link with ID ${puppetId}`);
				}
				break;
			}
			case "unlink": {
				if (!param || !param.trim()) {
					await this.sendMessage(roomId, `ERROR: You need to specify an index to unlink`);
					return;
				}
				const puppetId = Number(param.trim());
				if (isNaN(puppetId)) {
					await this.sendMessage(roomId, `ERROR: The index must be a number`);
					return;
				}
				const data = await this.provisioner.get(puppetId);
				if (!data || data.puppetMxid !== sender) {
					await this.sendMessage(roomId, `ERROR: You must own the index`);
					return;
				}
				await this.provisioner.delete(sender, puppetId);
				await this.sendMessage(roomId, `Removed link with ID ${puppetId}`);
				break;
			}
			default: {
				let handled = false;
				for (const name in this.commands) {
					if (this.commands.hasOwnProperty(name) && name === arg) {
						handled = true;
						const sendMessage: SendMessageFn = async (s: string) => {
							await this.sendMessage(roomId, s);
						};
						if (this.commands[name].withPid) {
							const [, pidStr, p] = (param || "").split(/([^ ]*)(?: (.*))?/);
							const pid = parseInt(pidStr, 10);
							const d = await this.provisioner.get(pid);
							if (!d || d.puppetMxid !== sender) {
								await this.sendMessage(roomId, "ERROR: PuppetID not found");
								break;
							}
							await (this.commands[name].fn as PidCommandFn)(pid, p, sendMessage);
						} else {
							await (this.commands[name].fn as FullCommandFn)(sender, param, sendMessage);
						}
						break;
					}
				}
				if (!handled) {
					const commands = ["help", "link", "unlink", "relink"];
					for (const name in this.commands) {
						if (this.commands.hasOwnProperty(name)) {
							commands.push(name);
						}
					}
					await this.sendMessage(roomId, "Available commands: " + commands.join(", "));
				}
			}
		}
	}

	public async sendStatusMessage(puppetId: number, msg: string) {
		log.info(`Sending status message for puppetId ${puppetId}...`);
		const mxid = await this.provisioner.getMxid(puppetId);
		const info = await this.bridge.puppetStore.getOrCreateMxidInfo(mxid);
		if (!info.statusRoom) {
			// no status room present, nothing to do
			log.info("No status room found");
			return;
		}
		const desc = await this.provisioner.getDesc(mxid, puppetId);
		if (!desc) {
			// something went wrong
			log.error("Description is not found, this is very odd");
			return;
		}
		const sendStr = `[Status] ${puppetId}: ${desc.desc}: ${msg}`;
		await this.sendMessage(info.statusRoom, sendStr);
	}

	public registerCommand(name: string, command: ICommand) {
		if (command.withPid === undefined) {
			command.withPid = true;
		}
		this.commands[name] = command;
	}

	private registerDefaultCommands() {
		this.registerCommand("list", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await sendMessage("Nothing linked yet!");
					return;
				}
				let sendStr = "Links:\n";
				for (const d of descs) {
					const sendStrPart = ` - ${d.puppetId}: ${d.desc}\n`;
					if (sendStr.length + sendStrPart.length > MAX_MSG_SIZE) {
						await sendMessage(sendStr);
						sendStr = "";
					}
					sendStr += sendStrPart;
				}
				await sendMessage(sendStr);
			},
			help: "List all set links",
			withPid: false,
		});
		this.registerCommand("setmatrixtoken", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				if (!param || !param.trim()) {
					await this.provisioner.setToken(sender, null);
					await sendMessage(`Removed matrix token!`);
					return;
				}
				const token = param.trim();
				const hsUrl = await this.provisioner.getHsUrl(sender);
				const client = await this.bridge.userSync.getClientFromTokenCallback({
					token,
					hsUrl,
				});
				if (!client) {
					await sendMessage("ERROR: Invalid matrix token");
					return;
				}
				await this.provisioner.setToken(sender, token);
				await sendMessage(`Set matrix token`);
			},
			help: "Sets a matrix token to enable double-puppeting",
			withPid: false,
		});
		this.registerCommand("listusers", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				if (!this.bridge.hooks.listUsers) {
					await sendMessage("Feature not implemented!");
					return;
				}
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await sendMessage("Nothing linked yet!");
					return;
				}
				let reply = "";
				for (const d of descs) {
					const users = await this.bridge.hooks.listUsers(d.puppetId);
					reply += `## ${d.puppetId}: ${d.desc}:\n\n`;
					for (const u of users) {
						let replyPart = "";
						if (u.category) {
							replyPart = `\n### ${u.name}:\n\n`;
						} else {
							const mxid = await this.bridge.getMxidForUser({
								puppetId: d.puppetId,
								userId: u.id!,
							}, false);
							replyPart = ` - ${u.name}: [${u.name}](https://matrix.to/#/${mxid})\n`;
						}
						if (reply.length + replyPart.length > MAX_MSG_SIZE) {
							await sendMessage(reply);
							reply = "";
						}
						reply += replyPart;
					}
				}
				await sendMessage(reply);
			},
			help: "Lists all users that are linked",
			withPid: false,
		});
		this.registerCommand("listchannels", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				if (!this.bridge.hooks.listChans) {
					await sendMessage("Feature not implemented!");
					return;
				}
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await sendMessage("Nothing linked yet!");
					return;
				}
				let reply = "";
				for (const d of descs) {
					const chans = await this.bridge.hooks.listChans(d.puppetId);
					reply += `## ${d.puppetId}: ${d.desc}:\n\n`;
					for (const c of chans) {
						let replyPart = "";
						if (c.category) {
							replyPart = `\n### ${c.name}:\n\n`;
						} else {
							const mxid = await this.bridge.getMxidForChan({
								puppetId: d.puppetId,
								roomId: c.id!,
							});
							replyPart = ` - ${c.name}: [${c.name}](https://matrix.to/#/${mxid})\n`;
						}
						if (reply.length + replyPart.length > MAX_MSG_SIZE) {
							await sendMessage(reply);
							reply = "";
						}
						reply += replyPart;
					}
				}
				await sendMessage(reply);
			},
			help: "List all channels that are linked",
			withPid: false,
		});
	}

	private async sendMessage(roomId: string, message: string) {
		const html = md.render(message);
		await this.bridge.botIntent.underlyingClient.sendMessage(roomId, {
			msgtype: "m.notice",
			body: message,
			formatted_body: html,
			format: "org.matrix.custom.html",
		});
	}
}
