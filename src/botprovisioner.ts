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

import { PuppetBridge } from "./puppetbridge";
import { RetDataFn, IRetData, IRemoteRoom } from "./interfaces";
import { Provisioner } from "./provisioner";
import { PuppetType, PUPPET_TYPES } from "./db/puppetstore";
import { Log } from "./log";
import { TimedCache } from "./structures/timedcache";
import * as MarkdownIt from "markdown-it";
import { MatrixClient, MessageEvent, TextualMessageEventContent } from "matrix-bot-sdk";

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

	public async processEvent(roomId: string, event: MessageEvent<TextualMessageEventContent>) {
		if (event.type !== "m.room.message") {
			return; // not ours to handle
		}
		const sender = event.sender;
		// update the status room entry, if needed
		const senderInfo = await this.bridge.puppetStore.getOrCreateMxidInfo(sender);
		if (senderInfo.statusRoom !== roomId) {
			senderInfo.statusRoom = roomId;
			await this.bridge.puppetStore.setMxidInfo(senderInfo);
		}
		// parse the argument and parameters of the message
		const [, arg, param] = event.textBody.split(/([^ ]*)(?: (.*))?/);
		log.info(`Got message to process with arg=${arg}`);
		const fnCollect = this.fnCollectListeners.get(sender);
		switch (fnCollect ? "link" : arg) {
			case "relink":
			case "link": {
				let puppetId = -1;
				let parseParam = param;
				if (fnCollect) {
					puppetId = fnCollect.puppetId;
					parseParam = event.textBody;
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
					retData = await fnCollect.fn(event.textBody);
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
				if (!senderInfo.token) {
					const token = await this.provisioner.loginWithSharedSecret(sender);
					if (token) {
						await this.provisioner.setToken(sender, token);
						log.info("Enabled double puppeting for", sender, "with shared secret login");
					}
				}
				if (puppetId === -1) {
					// we need to create a new link
					puppetId = await this.provisioner.new(sender, retData.data || {}, retData.userId);
					await this.sendMessage(roomId, `Created new link with ID ${puppetId}`);
				} else {
					// we need to update an existing link
					await this.provisioner.update(sender, puppetId, retData.data || {}, retData.userId);
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
							const d = isNaN(pid) ? null : await this.provisioner.get(pid);
							if (!d || d.puppetMxid !== sender) {
								await this.sendMessage(roomId, "ERROR: PuppetID not found");
								break;
							}
							await (this.commands[name].fn as PidCommandFn)(pid, p, sendMessage);
						} else {
							await (this.commands[name].fn as FullCommandFn)(sender, param || "", sendMessage);
						}
						break;
					}
				}
				if (!handled) {
					await this.sendMessage(roomId, "Command not found! Please type `help` to see a list of" +
						" all commands or `help <command>` to get help on a specific command.");
				}
			}
		}
	}

	public async sendStatusMessage(room: number | IRemoteRoom, msg: string) {
		let puppetId = -1;
		if (isNaN(room as number)) {
			puppetId = (room as IRemoteRoom).puppetId;
		} else {
			puppetId = room as number;
		}
		log.info(`Sending status message for puppetId ${puppetId}...`);
		const mxid = await this.provisioner.getMxid(puppetId);
		let roomMxid: string = "";
		let sendStr = "[Status] ";
		let client: MatrixClient | undefined;
		if (isNaN(room as number)) {
			const maybeRoomMxid = await this.bridge.roomSync.maybeGetMxid(room as IRemoteRoom);
			if (!maybeRoomMxid) {
				log.error("Room MXID is not found, this is very odd");
				return;
			}
			roomMxid = maybeRoomMxid;
			const ghost = (await this.bridge.puppetStore.getGhostsInRoom(roomMxid))[0];
			if (ghost) {
				client = this.bridge.AS.getIntentForUserId(ghost).underlyingClient;
			}
		} else {
			const info = await this.bridge.puppetStore.getOrCreateMxidInfo(mxid);
			if (!info.statusRoom) {
				// no status room present, nothing to do
				log.info("No status room found");
				return;
			}
			roomMxid = info.statusRoom;

			const desc = await this.provisioner.getDesc(mxid, puppetId);
			if (!desc) {
				// something went wrong
				log.error("Description is not found, this is very odd");
				return;
			}
			sendStr += `${puppetId}: ${desc.desc}: `;
		}
		sendStr += msg;
		await this.sendMessage(roomMxid, sendStr, client);
	}

	public registerCommand(name: string, command: ICommand) {
		if (command.withPid === undefined) {
			command.withPid = true;
		}
		this.commands[name] = command;
	}

	private registerDefaultCommands() {
		this.registerCommand("help", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				param = param.trim();
				if (!param) {
					const commands = ["`help`", "`link`", "`unlink`", "`relink`"];
					for (const name in this.commands) {
						if (this.commands.hasOwnProperty(name)) {
							commands.push(`\`${name}\``);
						}
					}
					const msg = `Available commands: ${commands.join(", ")}\n\nType \`help <command>\` to get more help on them.`;
					await sendMessage(msg);
					return;
				}
				// alright, let's display some help!
				if (!this.commands[param]) {
					await sendMessage(`Command \`${param}\` not found!`);
					return;
				}
				await sendMessage(this.commands[param].help);
			},
			help: `List all commands and optionally get help on specific ones.

Usage: \`help\`, \`help <command>\``,
			withPid: false,
		});
		this.registerCommand("list", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await sendMessage("Nothing linked yet!");
					return;
				}
				let sendStr = "Links:\n";
				for (const d of descs) {
					let sendStrPart = ` - ${d.puppetId}: ${d.desc}`;
					if (d.type !== "puppet") {
						sendStrPart += ` (type: ${d.type})`;
					}
					if (d.isPublic) {
						sendStrPart += " **public!**";
					}
					sendStrPart += "\n";
					if (sendStr.length + sendStrPart.length > MAX_MSG_SIZE) {
						await sendMessage(sendStr);
						sendStr = "";
					}
					sendStr += sendStrPart;
				}
				await sendMessage(sendStr);
			},
			help: `List all set links along with their information.

Usage: \`list\``,
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
			help: `Sets a matrix token to enable double-puppeting.

Usage: \`setmatrixtoken <token>\``,
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
			help: `Lists all users that are linked currently, from all links.

Usage: \`listusers\``,
			withPid: false,
		});
		this.registerCommand("listrooms", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				if (!this.bridge.hooks.listRooms) {
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
					const rooms = await this.bridge.hooks.listRooms(d.puppetId);
					reply += `## ${d.puppetId}: ${d.desc}:\n\n`;
					for (const r of rooms) {
						let replyPart = "";
						if (r.category) {
							replyPart = `\n### ${r.name}:\n\n`;
						} else {
							const mxid = await this.bridge.getMxidForRoom({
								puppetId: d.puppetId,
								roomId: r.id!,
							});
							replyPart = ` - ${r.name}: [${r.name}](https://matrix.to/#/${mxid})\n`;
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
			help: `List all rooms that are linked currently, from all links.

Usage: \`listrooms\``,
			withPid: false,
		});
		this.registerCommand("settype", {
			fn: async (puppetId: number, param: string, sendMessage: SendMessageFn) => {
				if (!PUPPET_TYPES.includes(param as PuppetType)) {
					await sendMessage("ERROR: Invalid type. Valid types are: " + PUPPET_TYPES.map((s) => `\`${s}\``).join(", "));
					return;
				}
				await this.provisioner.setType(puppetId, param as PuppetType);
				await sendMessage(`Set puppet type to ${param}`);
			},
			help: `Sets the type of a given puppet. Valid types are "puppet" and "relay".

Usage: \`settype <puppetId> <type>\``,
		});
		this.registerCommand("setispublic", {
			fn: async (puppetId: number, param: string, sendMessage: SendMessageFn) => {
				const isPublic = param === "1" || param === "true";
				await this.provisioner.setIsPublic(puppetId, isPublic);
				await sendMessage(`Set puppet to ${isPublic ? "public" : "private"}`);
			},
			help: `Sets if the given puppet is public.

Usage: \`setispublic <puppetId> <1/0>`,
		});
		this.registerCommand("setautoinvite", {
			fn: async (puppetId: number, param: string, sendMessage: SendMessageFn) => {
				const autoinvite = param === "1" || param === "true";
				await this.provisioner.setAutoinvite(puppetId, autoinvite);
				await sendMessage(`Set puppet to ${autoinvite ? "autoinvite" : "ignore"}`);
			},
			help: `Sets if the given puppet should autoinvite you to new rooms.

Usage: \`setautoinvite <puppetId> <1/0>`,
		});
		this.registerCommand("invite", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				const success = await this.provisioner.invite(sender, param);
				if (success) {
					await sendMessage("Sent invite to the room!");
				} else {
					await sendMessage("Couldn't send invite to the room. Perhaps you don't have permission to see it?");
				}
			},
			help: `Receive an invite to a room. The room resolvable can be a matrix.to link, a room ID, an alias or a user ID.

Usage: \`invite <room resolvable>\``,
			withPid: false,
		});
		this.registerCommand("unbridge", {
			fn: async (sender: string, param: string, sendMessage: SendMessageFn) => {
				const success = await this.provisioner.unbridge(sender, param);
				if (success) {
					await sendMessage("Unbridged the room!");
				} else {
					await sendMessage("Couldn't unbridge the room. Perhaps it doesn't exist or you aren't the owner of it?");
				}
			},
			help: `Unbridge a room. The room resolvable can be a matrix.to link, a room ID, an alias or a user ID.

Usage: \`unbridge <room resolvable>\``,
			withPid: false,
		});
	}

	private async sendMessage(roomId: string, message: string, client?: MatrixClient) {
		const html = md.render(message);
		if (!client) {
			client = this.bridge.botIntent.underlyingClient;
		}
		await client.sendMessage(roomId, {
			msgtype: "m.notice",
			body: message,
			formatted_body: html,
			format: "org.matrix.custom.html",
		});
	}
}
