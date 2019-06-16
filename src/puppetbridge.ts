import * as fs from "fs";
import {
	Appservice,
	IAppserviceRegistration,
} from "matrix-bot-sdk";
import * as uuid from "uuid/v4";
import * as yaml from "js-yaml";

export interface IPuppetBridgeRegOpts {
	prefix: string;
	id: string;
	url: string;
	botUser?: string;
};

export class PuppetBridge {
	constructor(
		private registrationPath: string,
	) { }
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
	async start() {
		const registration = yaml.safeLoad(fs.readFileSync(this.registrationPath, "utf8")) as IAppserviceRegistration;
		const appservice = new Appservice({
			bindAddress: "localhost",
			homeserverName: "localhost",
			homeserverUrl: "http://localhost",
			port: 8095,
			registration,
		});
		appservice.on("room.invite", (roomId: string, event: any) => {
			console.log(`Got invite in ${roomId} with event ${event}`);
		});
		await appservice.begin();
	}
}
