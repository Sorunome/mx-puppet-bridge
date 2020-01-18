import { IStringFormatterVars } from "./structures/stringformatter";

export interface IRemoteProfile {
	avatarUrl?: string | null;
	avatarBuffer?: Buffer | null;
	name?: string | null;
	nameVars?: IStringFormatterVars | null;
}

interface IRemoteBase extends IRemoteProfile {
	puppetId: number;
	externalUrl?: string | null;
}

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
}

export interface IRemoteGroup extends IRemoteBase {
	groupId: string;
	shortDescription?: string | null;
	longDescription?: string | null;
	roomIds?: string[] | null;
}

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
	eventId?: string;
}

export interface IMemberInfo {
	membership: string;
	displayname?: string | null;
	avatar_url?: string | null;
}
export type RetDataFn = (line: string) => Promise<IRetData>;

export interface IRetData {
	success: boolean;
	error?: string;
	data?: any;
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

export type CreateUserHook = (user: IRemoteUser) => Promise<IRemoteUser | null>;
export type CreateRoomHook = (room: IRemoteRoom) => Promise<IRemoteRoom | null>;
export type CreateGroupHook = (group: IRemoteGroup) => Promise<IRemoteGroup | null>;
export type GetDescHook = (puppetId: number, data: any) => Promise<string>;
export type BotHeaderMsgHook = () => string;
export type GetDataFromStrHook = (str: string) => Promise<IRetData>;
export type GetDmRoomIdHook = (user: IRemoteUser) => Promise<string | null>;
export type ListUsersHook = (puppetId: number) => Promise<IRetList[]>;
export type ListRoomsHook = (puppetId: number) => Promise<IRetList[]>;
