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

typingTimeout (number) // timeout for typing in ms

edit // if the protocol imlementation has edit support
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
### IRemoteRoom
This object is needed for sending or receiving room-related things from and to matrix
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
This object is a combination of `IRemoteRoom` and `IRemoteUser`. Used to combind which user sent something where
```ts
{
	room: IRemoteRoom; // room to send to
	user: IRemoteUser; // user which sent something
	eventId: string; (optional) // the remote event ID
	externalUrl: string; (optional) // an external URL referring to this event
}
```

### IMessageEvent
This object holds the main data for a message event
```ts
{
	body: string; // the plain text body
	formattedBody: string; (optional) // if present, the html formatting of the message
	emote: boolean;  (optional) // if the messgae is an emote (/me) message
	notice: boolean; (optional) // if the message is a bot message
	eventId: string; (optional) // the event ID. When receiving to send to remote, the matrix one, when sending to matrix, the remote one
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
	eventId: string; (optional) // the event ID. When receiving to send to remote, the matrix one, when sending to matrix, the remote one
}
```

## Events
Events are used so that the protocol implementation can listen to them and thus handle stuffs from matrix
### message
A message has been sent from matrix!
Event parameters:
```ts
room: IRemoteRoom; // the room where to send to
data: IMessageEvent; // the data on the message
asUser: ISendingUser | null, // optionally, as which user to send
event: any; // the raw message event
```

### edit
If feature enabled, an edit has been made from matrix
Event parameters:
```ts
room: IRemoteRoom; // the room where the edit happened
eventId: string; // the remote event ID of the original event
data: IMessageEvent; // the data on the new message
asUser: ISendingUser | null, // optionally, as which user to send
event: any; // the raw message event
```

### redact
A redact happened from matrix
Event parameters:
```ts
room: IRemoteRoom; // the room where the redact happened
eventId: string; // the remote event ID that got redacted
asUser: ISendingUser | null, // optionally, as which user to send
event: any; // the raw redact event
```

### file events
File events are `image`, `audio`, `video`, `sticker` and `file`. Appropriate fallbacks are used if feature not enabled, all the way back to plain text messages. They all use the same parameters
```ts
room: IRemoteRoom; // the room where to send to
data: IFileEvent; // the data on the file
asUser: ISendingUser | null, // optionally, as which user to send
event: any; // the raw file event
```

### presence
A presence event from matrix
Event parameters:
```ts
puppetId: number; // the puppet id
presence: IPresenceEvent; // the presence
asUser: ISendingUser | null, // optionally, as which user to send
rawEvent: any; // raw event
```

### typing
A typing event from matrix
Event parameters:
```ts
room: IRemoteRoom; // the room where the typing happened
typing: boolean; // true / false
asUser: ISendingUser | null, // optionally, as which user to send
rawEvent: any; // raw event
```

### read
A read event from matrix
Event parameters:
```ts
room: IRemoteRoom; // the room where the read happened
eventId: string; // the remote event id where the read happened
content: any; // the content of the event
asUser: ISendingUser | null, // optionally, as which user to send
rawEvent: any; // raw event
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
params: IReceiveParams; // room and user where/who sent something
opts: IMessageEvent; // what to send
```

### sendEdit
`sendEdit` sends an edit over to matrix. Parameters are:
```ts
params: IReceiveParams; // room and user who made the edit
eventId: string; // the remote event ID that got edited
opts: IMessageEvent; // the new message
ix: number = 0; // optional, index of the message to edit, if multiple are found
```

### sendRedact
`sendRedact` sends a redact over to matrix. Parameters are:
```ts
params: IReceiveParams; // room and user who made the redact
eventId: string; // the remote event ID that got redacted
```

### file sending
Again, multiple file sending messages for different file formats and for autodetecting. They all have the same parameters. The methods are `sendImage`, `sendAudio`, `sendVideo`, `sendFile`, `sendFileDetect`. Parameters are
```ts
params: IReceiveParams; // room and user where/who sent something
thing: string | Buffer; // either a URL or a buffer of the file to send
name: string (optional); // name of the file
```

### getPuppetMxidInfo
`getPuppetMxidInfo` gets the mxid information, or null, of a puppet.
It takes the parameters:
```ts
puppetId: number;
```

### sendStastusMessage
`sendStatusMessage` sends a status message - either to the status room or into a specified room.
```ts
puppetId: number | IRemoteRoom; // if it is IRemoteRoom then it sends to that room
msg: string; // markdown formatted string
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

### sendReadReceipt
`sendReadReceipt` senda a read receipt
```ts
params: IReceiveParams; // eventId is required in this case
```

### setUserPresence
`setUserPresence` sets the presence of a user
```ts
user: IRemoteUser;
presence: "online" | "offline" | "unavailable";
```

### updateRoom
`updateRoom` triggers a remote updating of a room
```ts
room: IRemoteRoom;
```

### bridgeRoom
`bridgeRoom` triggers the bridging of a room, or updates it if it exists
```ts
room: IRemoteRoom;
```

### unbridgeRoom
`unbridgeRoom` triggers a room to be unbridged, e.g. if in a 1:1 conversation the remote user left the room
```ts
room: IRemoteRoom;
```

### unbridgeRoomByMxid
same as unbridgeRoom but it takes the mxid of a room
```ts
mxid: string;
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

### setUserId
`setUserId` sets what the remote user ID of the puppet is
```ts
puppetId: number;
data: any;
```

## Event store methods
These are needed to insert events the protocol implementation sends out to the remote protocol into the event store. They are called with `eventStore.method`, e.g. `eventStore.insert`

### insert
`insert` inserts a new event into the event store. Parameters are:
```ts
puppetId: number;
matrixId: string; // you have this from the IMessageEvent and IFileEvent received from the bridge
remoteId: string; // the remote event Id
```

## Hooks
Hooks are crucial for provisioning. Setting them is done via calling `setHooknameHook` with the hook function as parameter, e.g. if the hook name is `createRoom` then you call `setCreateRoomHook`
### createRoom
This hook is called when a room is created. It is expected to return full information on the room. E.g. if the protocol implementation, for performance reasons, mostly only sends around room IDs, this should get name, topic and avatar.  
Returns `IRemoteRoom | null`  
Takes:
```ts
room: IRemoteRoom;
```

### createUser
Same as `createRoom` but for users  
Returns `IRemoteUser | null`  
Takes:
```ts
user: IRemoteUser;
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
This is crucial for provisioning: It will be called when a user tries to link to the remote server using the `link` command, and should return a data object that the protocol implementation will continue to use. e.g. a token  
Returns:  
```ts
success: boolean; // if this was successful
error: string (optional); // string to show if this wasn't successful, this can also be used to provide further login steps to the user
data: any (only when successful); // the resulting data needed to start puppets
userId: string (optional); // the user id of that puppet
fn: (str: string) => IRetData (optional, only_when_not_successful); // if set, this function will be called by the next message send by the user, this can be used for example for the user providing auth tokens acquired from following the steps previously described in the `error` message.  
```
Takes:  
```ts
str: string;
```

### botHeaderMsg
Just return a nice header for the bot to send in chat for provisioning  
Returns: `string`  
Takes: *none*
