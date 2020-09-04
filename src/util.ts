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

import * as http from "http";
import * as https from "https";
import * as fileType from "file-type";
import { Buffer } from "buffer";
import * as hasha from "hasha";
import { MatrixClient } from "@sorunome/matrix-bot-sdk";
import { Log } from "./log";
import { IProfileDbEntry } from "./db/interfaces";
import { IRemoteProfile } from "./interfaces";
import { StringFormatter } from "./structures/stringformatter";
import { spawn } from "child_process";
import got, { Response, OptionsOfBufferResponseBody } from "got";

const log = new Log("Util");

const HTTP_OK = 200;

export interface IMakeUploadFileData {
	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
	downloadFile?: ((url: string) => Promise<Buffer>) | null;
}

export class Util {
	public static async DownloadFile(
		url: string,
		options: OptionsOfBufferResponseBody = {responseType: "buffer"},
	): Promise<Buffer> {
		if (!options.method) {
			options.method = "GET";
		}
		options.url = url;
		return await got(options).buffer();
	}

	public static GetMimeType(buffer: Buffer): string | undefined {
		const typeResult = fileType(buffer);
		if (!typeResult) {
			return undefined;
		}
		return typeResult.mime;
	}

	public static str2mxid(a: string): string {
		// tslint:disable:no-magic-numbers
		const buf = Buffer.from(a);
		let encoded = "";
		for (const b of buf) {
			if (b === 0x5F) {
				// underscore
				encoded += "__";
			} else if ((b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39)) {
				// [a-z0-9]
				encoded += String.fromCharCode(b);
			} else if (b >= 0x41 && b <= 0x5A) {
				encoded += "_" + String.fromCharCode(b + 0x20);
			} else if (b < 16) {
				encoded += "=0" + b.toString(16);
			} else {
				encoded += "=" + b.toString(16);
			}
		}
		return encoded;
		// tslint:enable:no-magic-numbers
	}

	public static mxid2str(b: string): string {
		// tslint:disable:no-magic-numbers
		const decoded = Buffer.alloc(b.length);
		let j = 0;
		for (let i = 0; i < b.length; i++) {
			const char = b[i];
			if (char === "_") {
				i++;
				if (b[i] === "_") {
					decoded[j] = 0x5F;
				} else {
					decoded[j] = b[i].charCodeAt(0) - 0x20;
				}
			} else if (char === "=") {
				i++;
				decoded[j] = parseInt(b[i] + b[i + 1], 16);
				i++;
			} else {
				decoded[j] = b[i].charCodeAt(0);
			}
			j++;
		}
		return decoded.toString("utf8", 0, j);
		// tslint:enable:no-magic-numbers
	}

	public static async sleep(timeout: number): Promise<void> {
		return new Promise((resolve, reject) => {
			setTimeout(resolve, timeout);
		});
	}

	public static async AsyncForEach(arr, callback) {
		for (let i = 0; i < arr.length; i++) {
			await callback(arr[i], i, arr);
		}
	}

	public static HashBuffer(b: Buffer): string {
		return hasha(b, {
			algorithm: "sha512",
		});
	}

	public static async MaybeUploadFile(
		uploadFn: (b: Buffer, m?: string, f?: string) => Promise<string>,
		data: IMakeUploadFileData,
		oldHash?: string | null,
	): Promise<{ doUpdate: boolean; mxcUrl: string | undefined; hash: string; }> {
		let buffer = data.avatarBuffer;
		if ((!buffer && !data.avatarUrl) || (buffer && buffer.byteLength === 0)) {
			// we need to remove the avatar, short-circuit out of here
			return {
				doUpdate: true,
				mxcUrl: undefined,
				hash: "",
			};
		}
		try {
			log.silly(data.avatarUrl);
			if (!buffer) {
				log.silly("fetching avatar...");
				if (data.downloadFile) {
					buffer = await data.downloadFile(data.avatarUrl!);
				} else {
					buffer = await Util.DownloadFile(data.avatarUrl!);
				}
				log.silly("avatar fetched!");
			}
			const hash = Util.HashBuffer(buffer!);
			if (hash === oldHash) {
				// image didn't change, short-circuit out of here
				return {
					doUpdate: false,
					mxcUrl: undefined,
					hash,
				};
			}

			let filename = "remote_avatar";
			if (data.avatarUrl) {
				const matches = data.avatarUrl.match(/\/([^\.\/]+\.[a-zA-Z0-9]+)(?:$|\?)/);
				if (matches) {
					filename = matches[1];
				}
			}
			const avatarMxc = await uploadFn(buffer, Util.GetMimeType(buffer), filename);
			return {
				doUpdate: true,
				mxcUrl: avatarMxc,
				hash,
			};
		} catch (err) {
			log.error("Error uploading file content:", err);
			return {
				doUpdate: false,
				mxcUrl: undefined,
				hash: "",
			};
		}
	}

	public static async ProcessProfileUpdate(
		oldProfile: IProfileDbEntry | null,
		newProfile: IRemoteProfile,
		namePattern: string,
		uploadFn: (b: Buffer, m?: string, f?: string) => Promise<string>,
	): Promise<IProfileDbEntry> {
		log.info("Processing profile update...");
		log.verbose(oldProfile, "-->", newProfile);
		// first we apply the name patterns, if applicable
		if (newProfile.name != null && newProfile.name !== undefined) {
			if (!newProfile.nameVars) {
				newProfile.nameVars = {};
			}
			newProfile.nameVars.name = newProfile.name;
		}
		let checkName: string | null | undefined;
		if (newProfile.nameVars) {
			checkName = StringFormatter.format(namePattern, newProfile.nameVars);
		} else {
			checkName = newProfile.name;
		}
		const result: IProfileDbEntry = {};
		if (oldProfile === null) {
			log.verbose("No old profile exists, creating a new one");
			if (checkName) {
				result.name = checkName;
			}
			if (newProfile.avatarUrl || newProfile.avatarBuffer) {
				log.verbose("Uploading avatar...");
				const { doUpdate: doUpdateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(uploadFn, newProfile);
				if (doUpdateAvatar) {
					result.avatarHash = hash;
					result.avatarMxc = mxcUrl as string;
					result.avatarUrl = newProfile.avatarUrl;
				}
			}
			return result;
		}
		log.verbose("Old profile exists, looking at diff...");
		if (checkName !== undefined && checkName !== null && checkName !== oldProfile.name) {
			result.name = checkName;
		}
		if ((newProfile.avatarUrl !== undefined && newProfile.avatarUrl !== null
			&& newProfile.avatarUrl !== oldProfile.avatarUrl) || newProfile.avatarBuffer) {
			log.verbose("Uploading avatar...");
			const { doUpdate: doUpdateAvatar, mxcUrl, hash } = await Util.MaybeUploadFile(uploadFn, newProfile,
				oldProfile.avatarHash);
			if (doUpdateAvatar) {
				result.avatarHash = hash;
				result.avatarMxc = mxcUrl as string;
				result.avatarUrl = newProfile.avatarUrl;
			}
		}
		return result;
	}

	// tslint:disable-next-line no-any
	public static async ffprobe(buffer: Buffer): Promise<any> {
		// tslint:disable-next-line no-any
		return new Promise<any>((resolve, reject) => {
			const cmd = spawn("ffprobe", ["-i", "-", "-v", "error", "-print_format", "json", "-show_format", "-show_streams"]);
			const TIMEOUT = 5000;
			const timeout = setTimeout(() => {
				cmd.kill();
			}, TIMEOUT);
			let databuf = "";
			cmd.stdout.on("data", (data: string) => {
				databuf += data;
			});
			cmd.stdout.on("error", (error) => {}); // disregard
			cmd.on("error", (error) => {
				cmd.kill();
				clearTimeout(timeout);
				reject(error);
			});
			cmd.on("close", (code: number) => {
				clearTimeout(timeout);
				try {
					resolve(JSON.parse(databuf));
				} catch (err) {
					reject(err);
				}
			});
			cmd.stdin.on("error", (error) => {}); // disregard
			cmd.stdin.end(buffer);
		});
	}

	public static async getExifOrientation(buffer: Buffer): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			const cmd = spawn("identify", ["-format", "'%[EXIF:Orientation]'", "-"]);
			const TIMEOUT = 5000;
			const timeout = setTimeout(() => {
				cmd.kill();
			}, TIMEOUT);
			let databuf = "";
			cmd.stdout.on("data", (data: string) => {
				databuf += data;
			});
			cmd.stdout.on("error", (error) => {}); // disregard
			cmd.on("error", (error) => {
				cmd.kill();
				clearTimeout(timeout);
				reject(error);
			});
			cmd.on("close", (code: number) => {
				clearTimeout(timeout);
				try {
					resolve(Number(databuf.replace(/.*(\d+).*/, "$1")));
				} catch (err) {
					reject(err);
				}
			});
			cmd.stdin.on("error", (error) => {}); // disregard
			cmd.stdin.end(buffer);
		});
	}
}
