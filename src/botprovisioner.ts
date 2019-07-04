import { PuppetBridge } from "./puppetbridge";
import { Provisioner } from "./provisioner";
import { Log } from "./log";
import * as escapeHtml from "escape-html";

const log = new Log("BotProvisioner");

export class BotProvisioner {
	private provisioner: Provisioner;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.provisioner = this.bridge.provisioner;
	}

	public async processEvent(event: any) {
		if (event.type !== "m.room.message") {
			return; // not ours to handle
		}
		const roomId = event.room_id;
		const sender = event.sender;
		const [_, arg, param] = event.content.body.split(/([^ ]*)(:? (.*))?/);
		log.info(`Got message to process with arg=${arg}`);
		if (this.bridge.hooks.botHeaderMsg) {
			await this.sendMessage(roomId, this.bridge.hooks.botHeaderMsg());
		}
		switch (arg) {
			case "link": {
				if (!this.provisioner.canCreate(sender)) {
					await this.sendMessage(roomId, "ERROR: You don't have permission to use this bridge");
					break;
				}
				if (!this.bridge.hooks.getDataFromStr) {
					await this.sendMessage(roomId, "ERROR: The bridge is still starting up, please try again shortly");
					break;
				}
				const retData = await this.bridge.hooks.getDataFromStr(param);
				if (!retData.success) {
					await this.sendMessage(roomId, `ERROR: ${retData.error}`);
					break;
				}
				const puppetId = await this.provisioner.new(sender, retData.data, retData.userId);
				await this.sendMessage(roomId, `Created new link with ID ${puppetId}`);
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
			case "list": {
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await this.sendMessage(roomId, "Nothing linked yet!");
					break;
				}
				let sendStr = "Links:\n";
				let html = "<p>Links:</p><ul>";
				for (const d of descs) {
					sendStr += `${d.puppetId}: ${d.desc}\n`;
					html += `<li>${d.puppetId}: ${d.html}</li>`;
				}
				html += "</ul>";
				await this.sendMessage(roomId, sendStr, html);
				break;
			}
			case "setmatrixtoken": {
				if (!param || !param.trim()) {
					await this.provisioner.setToken(sender, null);
					await this.sendMessage(roomId, `Removed matrix token!`);
					break;
				}
				const token = param.trim();
				const tokenParts = await this.provisioner.parseToken(sender, token);
				const client = await this.bridge.userSync.getClientFromTokenCallback(tokenParts);
				if (!client) {
					await this.sendMessage(roomId, "ERROR: Invalid matrix token");
					break;
				}
				await this.provisioner.setToken(sender, token);
				await this.sendMessage(roomId, `Set matrix token`);
				break;
			}
			case "listusers": {
				if (!this.bridge.hooks.listUsers) {
					await this.sendMessage(roomId, "Feature not implemented!");
					break;
				}
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await this.sendMessage(roomId, "Nothing linked yet!");
					break;
				}
				let reply = "";
				let replyHtml = "";
				for (const d of descs) {
					const users = await this.bridge.hooks.listUsers(d.puppetId);
					reply += `${d.puppetId}: ${d.desc}:\n\n`;
					replyHtml += `<h2>${d.puppetId}: ${d.html}:</h2><ul>`;
					for (const u of users) {
					const nameHtml = escapeHtml(u.name);
						if (u.category) {
							reply += `${u.name}:\n`;
							replyHtml += `</ul><h3>${nameHtml}</h3><ul>`;
							continue;
						}
						reply += ` - ${u.name}\n`;
						const mxid = await this.bridge.getMxidForUser({
							puppetId: d.puppetId,
							userId: u.id!,
						}, false);
						const pill = `<a href="https://matrix.to/#/${escapeHtml(mxid)}">${nameHtml}</a>`;
						replyHtml += `<li>${nameHtml}: ${pill}</li>`;
					}
					replyHtml += "</ul>";
				}
				await this.sendMessage(roomId, reply, replyHtml);
				break;
			}
			case "listchannels": {
				if (!this.bridge.hooks.listChans) {
					await this.sendMessage(roomId, "Feature not implemented!");
					break;
				}
				const descs = await this.provisioner.getDescMxid(sender);
				if (descs.length === 0) {
					await this.sendMessage(roomId, "Nothing linked yet!");
					break;
				}
				let reply = "";
				let replyHtml = "";
				for (const d of descs) {
					const chans = await this.bridge.hooks.listChans(d.puppetId);
					reply += `${d.puppetId}: ${d.desc}:\n\n`;
					replyHtml += `<h2>${d.puppetId}: ${d.html}:</h2><ul>`;
					for (const c of chans) {
					const nameHtml = escapeHtml(c.name);
						if (c.category) {
							reply += `${c.name}:\n`;
							replyHtml += `</ul><h3>${nameHtml}</h3><ul>`;
							continue;
						}
						reply += ` - ${c.name}\n`;
						const mxid = await this.bridge.getMxidForChan({
							puppetId: d.puppetId,
							roomId: c.id!,
						});
						const pill = `<a href="https://matrix.to/#/${escapeHtml(mxid)}">${nameHtml}</a>`;
						replyHtml += `<li>${nameHtml}: ${pill}</li>`;
					}
					replyHtml += "</ul>";
				}
				await this.sendMessage(roomId, reply, replyHtml);
				break;
			}
			default:
				await this.sendMessage(roomId, `Available commands: help, list, link, unlink, setmatrixtoken, listusers, listchannels`);
		}
	}

	private async sendMessage(roomId: string, message: string, html?: string) {
		if (!html) {
			await this.bridge.botIntent.sendText(roomId, message, "m.notice");
		} else {
			await this.bridge.botIntent.underlyingClient.sendMessage(roomId, {
				msgtype: "m.notice",
				body: message,
				formatted_body: html,
				format: "org.matrix.custom.html",
			});
		}
	}
}
