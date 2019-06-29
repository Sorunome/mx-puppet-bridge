import { PuppetBridge } from "./puppetbridge";
import { Provisioner } from "./provisioner";
import { Log } from "./log";

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
				const tokenParts = this.provisioner.parseToken(sender, token);
				const client = await this.bridge.userSync.getClientFromTokenCallback(tokenParts);
				if (!client) {
					await this.sendMessage(roomId, "ERROR: Invalid matrix token");
					break;
				}
				await this.provisioner.setToken(sender, token);
				await this.sendMessage(roomId, `Set matrix token`);
				break;
			}
			default:
				await this.sendMessage(roomId, `Available commands: help, list, link, unlink, setmatrixtoken`);
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
