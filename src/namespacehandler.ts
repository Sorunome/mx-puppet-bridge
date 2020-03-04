/*
Copyright 2020 mx-puppet-bridge
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

import { Log } from "./log";
import { Util } from "./util";
import { PuppetBridge } from "./puppetbridge";

const log = new Log("NamespaceHandler");

export class NamespaceHandler {
	private enabled: boolean;
	constructor(
		private bridge: PuppetBridge,
	) {
		this.enabled = Boolean(this.bridge.protocol.features.globalNamespace);
	}

	public async getSuffix(puppetId: number, id: string): Promise<string> {
		if (puppetId === -1) {
			if (!this.enabled) {
				throw new Error("Global namespace not enabled");
			}
			return `_${Util.str2mxid(id)}`;
		}
		if (this.enabled) {
			// maybe this is in a global namespace
			const puppetData = await this.bridge.provisioner.get(puppetId);
			if (!puppetData) {
				throw new Error("Puppet not found");
			}
			if (puppetData.isGlobalNamespace) {
				return `_${Util.str2mxid(id)}`;
			}
		}
		return `${puppetId}_${Util.str2mxid(id)}`;
	}

	public fromSuffix(suffix: string): null | { puppetId: number; id: string } {
		if (suffix[0] === "_") {
			if (!this.enabled) {
				return null;
			}
			return {
				puppetId: -1,
				id: Util.mxid2str(suffix.substr(1)),
			};
		}
		const SUFFIX_MATCH_PUPPET_ID = 1;
		const SUFFIX_MATCH_ID = 2;
		const matches = suffix.match(/^(\d+)_(.*)/);
		if (!matches) {
			return null;
		}
		const puppetId = Number(matches[SUFFIX_MATCH_PUPPET_ID]);
		const id = Util.mxid2str(matches[SUFFIX_MATCH_ID]);
		if (isNaN(puppetId)) {
			return null;
		}
		return {
			puppetId,
			id,
		};
	}
}
