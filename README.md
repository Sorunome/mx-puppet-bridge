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

### Automatic double-puppeting
It can be a hassle to have to tell the bridge what your access token is to enable double-puppeting.
To circumvent that automatic double-puppeting is available. Configure your homeserver with
[matrix-synapse-secret-auth](https://github.com/devture/matrix-synapse-shared-secret-auth) and set
the secert for that homeserver in the `bridge.loginSharedSecretMap` mapping.

## Bridging new protocols
To bridge a new protocol only a small amount of features has to be implemented. For examples see
the corresponding section. For a full list of available endpoints, see [bridge.md](https://github.com/Sorunome/mx-puppet-bridge/blob/master/bridge.md).
