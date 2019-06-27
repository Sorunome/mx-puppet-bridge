# How to create a bridge
This document explains how to create a bridge and documents the available API.

## Basic idea
`mx-puppet-bridge` tries to make it easy to implement puppeting bridges. As such, it provides an API for people to use to make it as easy as possible.

As such, you create an instance of the `PuppetBridge` class, listen to events on it to receive things from matrix, use methods of it to send things to matrix and register some callbacks for better integration.

## Features
The protocol implementation can set certain features to say that it supports something. These all default to not implemented. This allows this puppet bridge to have automatic fallbacks.
```ts
file // file sending implemented
image // image sending implemented
audio // audio sending implemented
video // video sending implemented
sticker // sticker sending implemented

presence // presence handling implemented
```

Pro-Tip: if your protocol implementation auto-detects file types, only set the feature `file`! That will cause `image`, `audio`, `video` and `sticker` to fall back to that.

## Important Variables
### puppetId: number
Each matrix user can create as many puppet bridges as they want. Among **all** users a unique `puppetId` (number) exists. This is for the protocol implementation to be able to keep track what goes where.

### roomId: string
Each protocol implementation sets a `roomId` (string). This needs to be a unique identifier to a room among **only** the puppetId. The protocol implementation *needs* to handle that 1:1 rooms and other rooms all have unique IDs. (e.g. remote protocol internal room ID)

### userId: string
Similar to the roomId, the protocol needs to set a `userId` (string). This is a unique identifier for a remote user among **only** the puppetId. (e.g. remote protocol internal puppet ID)

## Object types
These object types appear throughout the API.
### IRemoteChan
This object is needed for sending or receiving channel-related things from and to matrix
```ts
{
	roomId: string; // the remote ID of the room
	puppetId: number; // index number of the puppet

	avatarUrl: string; (optional) // avatar URL of the room icon
	avatarBuffer: Buffer; (optional) // avatar buffer of the room icon
	name: string; (optional) // name of the room
	topic: string; (optional) // topic of the room
	isDirect: boolean; (optional) // flag if the room is a 1:1 room
}
```

### IRemoteUser
This object is needed for sending or receiving user-related things from and to matrix
```ts
{
	userId: string; // the remote ID of the user
	puppetId: number; // index number of the puppet

	avatarUrl: string; (optional) // avatar URL of the user
	avatarBuffer: Buffer; (optional) // avatar buffer of the user
	name: string; (optional) // name of the user
}
```

### IReceiveParams
This object is a combination of `IRemoteChan` and `IRemoteUser`. Used to combind which user sent something where
```ts
{
	chan: IRemoteChan; // channel to send to
	user: IRemoteUser; // user which sent something
}
```

### IMessageEvent
This object holds the main data for a message event
```ts
{
	body: string; // the plain text body
	formatted_body: string; (optional) // if present, the html formatting of the message
	emote: boolean; // if the messgae is an emote (/me) message
	notice: boolean; (optional) // if the message is a bot message
}
```

### IFileEvent
This object holds the main data for a file event
```ts
{
	filename: string; // the filename of the file
	info?: {
		mimetype?: string; // the mimetype of the file
		size?: number; // the byte size of the file
		w?: number; // the width, if it is an image or a video
		h?: number; // the height, if it is an image or a video
	};
	mxc: string; // the mxc content uri of the file
	url: string; // an accessible URL of the file
}
```

## Events
Events are used so that the protocol implementation can listen to them and thus handle stuffs from matrix
### message
A message has been sent from matrix!
Event parameters:
```ts
room: IRemoteChan; // the room where to send to
data: IMessageEvent; // the data on the message
event: any; // the raw message event
```

### file events
File events are `image`, `audio`, `video`, `sticker` and `file`. Appropriate fallbacks are used if feature not enabled, all the way back to plain text messages. They all use the same parameters
```ts
room: IRemoteChan; // the room where to send to
data: IFileEvent; // the data on the file
event: any; // the raw file event
```

### puppetNew
This event is emitted if a new puppet has been created via the provisioner. The protocol implementation is expected to start bridging this puppet.
```ts
puppetId: number; // the NEW!!! puppetId of the puppet
data: any; // the provisioning data set by the protocol implementation
```

### puppetDelete
This event is emitted if a puppet has been deleted via the provisioner. The protocol implementation is expected to stop bridging this puppet.
```ts
puppetId: number; // delete this puppet
```

### puppetName
This event is emitted if the puppet (matrix user) changes their name
```ts
puppetId: number;
name: string;
```

### puppetAvatar
This event is emitted if the puppet (matrix user) changes their avatar
```ts
puppetId: number;
url: string;
mxc: string;
```

## Methods to send

### sendMessage
`sendMessage` sends a text message over to matrix. Parameters are:
```ts
params: IReceiveParams; // channel and user where/who sent something
opts: IMessageEvent; // what to send
```

### file sending
Again, multiple file sending messages for different file formats and for autodetecting. They all have the same parameters. The methods are `sendImage`, `sendAudio`, `sendVideo`, `sendFile`, `sendFileDetect`. Parameters are
```ts
params: IReceiveParams; // channel and user where/who sent something
thing: string | Buffer; // either a URL or a buffer of the file to send
name: string (optional); // name of the file
```

### getPuppetMxidInfo
`getPuppetMxidInfo` gets the mxid information, or null, of a puppet.
It takes the parameters:
```ts
puppetId: number;
```

### getMxidForUser
`getMxidForUser` gets the mxid for a given user, obaying puppeting stuff
```ts
user: IRemoteUser;
```

### setUserTyping
`setUserTyping` sets if a user is typing in a room or not
```ts
params: IReceiveParams;
typing: boolean;
```

### setUserPresence
`setUserPresence` sets the presence of a user
```ts
user: IRemoteUser;
presence: "online" | "offline" | "unavailable";
```

### updateChannel
`updateChannel` triggers a remote updating of a channel
```ts
chan: IRemoteChan;
```

### updateUser
`updateUser` triggers a remote updating of a user
```ts
user: IRemoteUser
```

### setPuppetData
`setPuppetData` sets the puppeting data provided by the protocol information, to e.g. be able to add metadata. **BE SURE TO KEEP THE REQUIRED DATA FOR THE PROTOCOL**
```ts
puppetId: number;
data: any;
```

## setUserId
`setUserId` sets what the remote user ID of the puppet is
```ts
puppetId: number;
data: any;
```

## Hooks
Hooks are crucial for provisioning. Setting them is done via calling `setHooknameHook` with the hook function as parameter, e.g. if the hook name is `createChan` then you call `setCreateChanHook`
### createChan
This hook is called when a channel is created. It is expected to return full information on the channel. E.g. if the protocol implementation, for performance reasons, mostly only sends around channel IDs, this should get name, topic and avatar.  
Returns `IRemoteChan`  
Takes:
```ts
puppetId: number;
chanId: string;
```

### createUser
Same as `createChan` but for users  
Returns `IRemoteUser`  
Takes:
```ts
puppetId: number;
userId: string;
```

### getDesc
This hook should return a human-readable description of a puppet, given the data provided.  
Returns: `string`  
Takes:  
```ts
puppetId: number;
data: any; // the data set by the protocol implementation
html: boolean; // if the reply should be HTML or not
```

### getDataFromStr
This is curcial for provisioning: Given a data, it should return a data object that the protocol implementation will continue to use. e.g. a token  
Returns:  
```ts
success: boolean; // if this was successful
error: string (optional); // string to show if this wasn't successful
data: any (only when successful); // the resulting data needed to start puppets
userId: string (optional); // the user id of that puppet
```
Takes:  
```ts
str: string;
```

### botHeaderMsg
Just return a nice header for the bot to send in chat for provisioning  
Returns: `string`  
Takes: *none*
