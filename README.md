[Support Chat](https://matrix.to/#/#mx-puppet-bridge:sorunome.de) [![donate](https://liberapay.com/assets/widgets/donate.svg)](https://liberapay.com/Sorunome/donate)

# mx-puppet-bridge
This is a library for easily building puppeting bridges for matrix.

A puppeting bridge is a bridge which logs into a remote account of a service for you (puppeting) and
thus allows you to use it via matrix. Matrix will basically act as a client for that remote
implementation. Double-puppeting is available, but 100% optional.

In addition to puppeting mode, this library also supports a relay mode: The account of the remote
protocol is used as relay bot between the remote protocol and matrix.

## Example implementation
 - [Echo](https://github.com/Sorunome/mx-puppet-echo), this just echos back messages sent to it

## Current protocol implementations
 - [Slack](https://github.com/Sorunome/mx-puppet-slack)
 - [Tox](https://github.com/Sorunome/mx-puppet-tox)
 - [Discord](https://github.com/matrix-discord/mx-puppet-discord)
 - [Instagram](https://github.com/Sorunome/mx-puppet-instagram)
 - [Twitter](https://github.com/Sorunome/mx-puppet-twitter)
 - [voip.ms](https://github.com/zoenb/mx-puppet-voipms)
 - [Skype](https://github.com/Sorunome/mx-puppet-skype)
 - [Steam](https://github.com/icewind1991/mx-puppet-steam)
 - [VK](https://github.com/innereq/mx-puppet-vk)
 - [GroupMe](https://gitlab.com/robintown/mx-puppet-groupme)

## Docs
 - [bridge.md](https://github.com/Sorunome/mx-puppet-bridge/blob/master/bridge.md)
 - `npm run docs`

## Features
Please note that not all protocol implementations support all features. This is just a feature list
of the features available in this library.
 - Plain messages
 - Formatted messages
 - Message edits
 - Message redactions
 - Message reactions
 - Send files/images/videos/audio/etc.
 - Remote user mapping
 - Remote room mapping
 - Remote group mapping
 - Multi-account (many matrix users can start many remote links)
 - Automatic double puppeting
 - Relay mode

### Group Mapping
For group mapping to work the homeserver in use has to support groups and group creation. For
synapse, you need to set `enable_group_creation: true` in your `homeserver.yaml`. After that, in the
protocols `config.yaml` set `bridge.enableGroupSync` to `true`.

### Relay mode
Relay mode is a mode where the remote puppet acts as a relay bot, rather than a puppeting bot. In
relay mode the display name of the author of the message on the matrix side is prepended to the
message.

To activate relay mode for a puppet type `settype <puppetId> relay`. If you want the rooms of said
relay to be publicly usable, type `setispublic <puppetId> 1`.

Be sure to whitelist the users you want to relay, a possible config for to relay everyone could look
as follows:
```yaml
relay:
  whitelist:
    - ".*"
```

### Plumbed rooms
In order for plumbed rooms to work the protocol implementation must support global namespace and at
least one puppet of relay type has to have been added. In your config you can specify who is able to
create plumbed rooms. If everyone should be able to, your config could look as follows:
```yaml
selfService:
  whitelist:
    - ".*"
```
After that, invite the bridge bot into the matrix room you want to bridge. Then type
`!<network identifier> bridge <remote room ID>`, for example for discord `!discord bridge 123456`. A
protocol implementation may add additional parsing to the remote room ID to allow multiple formats.

### Automatic double-puppeting
It can be a hassle to have to tell the bridge what your access token is to enable double-puppeting.
To circumvent that automatic double-puppeting is available. Configure your homeserver with
[matrix-synapse-secret-auth](https://github.com/devture/matrix-synapse-shared-secret-auth) and set
the secret for that homeserver in the `bridge.loginSharedSecretMap` mapping.

### Adding of metadata for images, videos and audio
Sent images, video and audio can have metadata added to them, for that make sure that `ffprobe`
is installed in your `$PATH`. It usually comes bundled with `ffmpeg`.

## Bridging new protocols
To bridge a new protocol only a small amount of features has to be implemented. For examples see
the corresponding section. For a full list of available endpoints, see [bridge.md](https://github.com/Sorunome/mx-puppet-bridge/blob/master/bridge.md).
### Features
Not all features need to be implemented by protocol implementations. Here are some features and which hooks are required to get them working:

| Feature | Hooks |
|---------|-------|
| normal functionality | `botHeaderMsg`, `getDataFromStr`, `getDesc` |
| make `listusers` working | `listUsers` |
| make `listrooms` working | `listRooms` |
| inject data on user creation | `createUser` |
| inject data on room creation | `createRoom` |
| enable group syncing | `createGroup` |
| initiate 1:1 rooms from the matrix side | `getDmRoomId`, `createRoom` |
| initiate rooms from the matrix side | `createRoom` |
| autopopulate rooms with users | `getUserIdsInRoom` |
