import * as http from "http";
import * as https from "https";
import * as fileType from "file-type";
import { Buffer } from "buffer";

 const HTTP_OK = 200;

export class Util {
	public static async DownloadFile(url: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			let ht;
			if (url.startsWith("https")) {
				ht = https;
			} else {
				ht = http;
			}
			const req = ht.get((url), (res) => {
				let buffer = Buffer.alloc(0);
				if (res.statusCode !== HTTP_OK) {
					reject(`Non 200 status code (${res.statusCode})`);
				}
				res.on("data", (d) => {
					buffer = Buffer.concat([buffer, d]);
				});
				res.on("end", () => {
					resolve(buffer);
				});
			});
			req.on("error", (err) => {
				reject(`Failed to download. ${err.code}`);
			});
		}) as Promise<Buffer>;
	}

	public static GetMimeType(buffer: Buffer): string | undefined {
		const typeResult = fileType(buffer);
		if (!typeResult) {
			return undefined;
		}
		return typeResult.mime;
	}
}
