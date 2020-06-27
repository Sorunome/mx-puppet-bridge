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

import { IStringFormatterVars } from "./structures/stringformatter";
import {
	MessageEvent, TextualMessageEventContent, FileMessageEventContent,
} from "@sorunome/matrix-bot-sdk";

type PuppetDataSingleType = string | number | boolean | IPuppetData | null | undefined;
export interface IPuppetData {
	[key: string]: PuppetDataSingleType | PuppetDataSingleType[];
}

export interface IRemoteProfile {
	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
	downloadFile?: ((url: string) => Promise<Buffer>) | null;
	name?: string | null;
	nameVars?: IStringFormatterVars | null;
}

interface IRemoteBase extends IRemoteProfile {
	puppetId: number;
	externalUrl?: string | null;
}

// we want to have this separate interface as we may expand
// on the type in the future, thus we recommend protocol implementations
// to use this
// tslint:disable-next-line no-empty-interface
export interface IRemoteUserRoomOverride extends IRemoteProfile { }

export interface IRemoteUser extends IRemoteBase {
	userId: string;
	roomOverrides?: {[roomId: string]: IRemoteUserRoomOverride} | null;
}

export interface IRemoteRoom extends IRemoteBase {
	roomId: string;
	topic?: string | null;
	groupId?: string | null;
	isDirect?: boolean | null;
	emotes?: (IRemoteEmote | IRemoteEmoteFragment)[] | null;
}

export interface IRemoteGroup extends IRemoteBase {
	groupId: string;
	shortDescription?: string | null;
	longDescription?: string | null;
	roomIds?: string[] | null;
}

export interface IRemoteEmoteFragment extends IRemoteProfile {
	roomId?: string | null;
	emoteId: string;
	externalUrl?: string | null;
	data?: IPuppetData | null;
}

export interface IRemoteEmote extends IRemoteBase {
	roomId?: string | null;
	emoteId: string;
	data?: IPuppetData | null;
	avatarMxc?: string | null;
}

type ResolvableString = string | undefined | null;
export type RemoteUserResolvable = IRemoteUser | ResolvableString;
export type RemoteRoomResolvable = RemoteUserResolvable | IRemoteRoom | ResolvableString;
export type RemoteGroupResolvable = RemoteRoomResolvable | IRemoteGroup | ResolvableString;

export interface IPuppetBridgeRegOpts {
	prefix: string;
	id: string;
	url: string;
	botUser?: string;
}

export interface IPuppetBridgeFeatures {
	// file features
	file?: boolean;
	image?: boolean;
	audio?: boolean;
	video?: boolean;
	// stickers
	sticker?: boolean;

	// presence
	presence?: boolean;

	// typing
	typingTimeout?: number;

	// event types
	edit?: boolean;
	reply?: boolean;

	// advanced relay
	advancedRelay?: boolean;

	// global namespace
	globalNamespace?: boolean;
}

export interface IReceiveParams {
	user: IRemoteUser;
	room: IRemoteRoom;
	eventId?: string;
	externalUrl?: string;
}

export interface IMessageEvent {
	body: string;
	formattedBody?: string;
	emote?: boolean;
	notice?: boolean;
	eventId?: string;
}

export interface IEventInfo {
	message?: IMessageEvent;
	file?: IFileEvent;
	event: MessageEvent<TextualMessageEventContent> | MessageEvent<FileMessageEventContent>;
	user: ISendingUser;
}

export interface IReplyEvent extends IMessageEvent {
	reply: IEventInfo;
}

export interface IFileEvent {
	filename: string;
	info?: {
		mimetype?: string;
		size?: number;
		w?: number;
		h?: number;
	};
	mxc: string;
	url: string;
	type: string;
	eventId?: string;
}

export type RetDataFn = (line: string) => Promise<IRetData>;

export interface IRetData {
	success: boolean;
	error?: string;
	data?: IPuppetData | Promise<IPuppetData>;
	userId?: string;
	fn?: RetDataFn;
}

export interface IRetList {
	name: string;
	id?: string;
	category?: boolean;
}

interface IProtocolInformationNamePatterns {
	user?: string;
	userOverride?: string;
	room?: string;
	group?: string;
}

export interface IProtocolInformation {
	id?: string;
	displayname?: string;
	externalUrl?: string;
	features?: IPuppetBridgeFeatures;
	namePatterns?: IProtocolInformationNamePatterns;
}

export interface ISendingUser {
	avatarMxc: string | null;
	avatarUrl: string | null;
	displayname: string;
	mxid: string;
	user: IRemoteUser | null;
}

export type CreateUserHook = (user: IRemoteUser) => Promise<IRemoteUser | null>;
export type CreateRoomHook = (room: IRemoteRoom) => Promise<IRemoteRoom | null>;
export type CreateGroupHook = (group: IRemoteGroup) => Promise<IRemoteGroup | null>;
export type UserExistsHook = (user: IRemoteUser) => Promise<boolean>;
export type RoomExistsHook = (room: IRemoteRoom) => Promise<boolean>;
export type GroupExistsHook = (group: IRemoteGroup) => Promise<boolean>;
export type GetDescHook = (puppetId: number, data: IPuppetData) => Promise<string>;
export type BotHeaderMsgHook = () => string;
export type GetDataFromStrHook = (str: string) => Promise<IRetData>;
export type GetDmRoomIdHook = (user: IRemoteUser) => Promise<string | null>;
export type ListUsersHook = (puppetId: number) => Promise<IRetList[]>;
export type ListRoomsHook = (puppetId: number) => Promise<IRetList[]>;
export type ListGroupsHook = (puppetId: number) => Promise<IRetList[]>;
export type GetUserIdsInRoomHook = (room: IRemoteRoom) => Promise<Set<string> | null>;
export type ResolveRoomIdHook = (ident: string) => Promise<string | null>;
