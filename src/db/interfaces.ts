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

import { IPuppetData } from "../interfaces";

export interface IProfileDbEntry {
	name?: string | null;
	avatarUrl?: string | null;
	avatarMxc?: string | null;
	avatarHash?: string | null;
}

export interface IUserStoreEntry extends IProfileDbEntry {
	puppetId: number;
	userId: string;
	externalUrl?: string | null;
}

export interface IUserStoreRoomOverrideEntry extends IProfileDbEntry {
	puppetId: number;
	userId: string;
	roomId: string;
}

export interface IRoomStoreEntry extends IProfileDbEntry {
	mxid: string;
	roomId: string;
	puppetId: number;
	topic?: string | null;
	groupId?: string | null;
	isDirect: boolean;
	e2be: boolean;
	externalUrl?: string | null;
	isUsed: boolean;
}

export interface IGroupStoreEntry extends IProfileDbEntry {
	mxid: string;
	groupId: string;
	puppetId: number;
	shortDescription?: string | null;
	longDescription?: string | null;
	roomIds: string[];
	externalUrl?: string | null;
}

export interface IEmoteStoreEntry extends IProfileDbEntry {
	puppetId: number;
	roomId: string | null;
	emoteId: string;
	data: IPuppetData;
}
