# 05: Discord bot plugin and channel

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-csae, cn-q259, cn-65gg, cn-y1ac

**What to build:** Guided bot setup (application, token into the vault, invite link); Discord tools (channels, read, send with files, react, DMs); a gateway connection held by a Durable Object; Discord as a channel of Mr. Robot: messages on a robot's channel or DM become wake-ups, replies and notifications return there; robot↔channel mapping in settings.

**Blocked by:** 01 Connector core, Plugins page, per-plugin settings rows

**Status:** ready-for-agent

- [ ] Live: bot joins the owner's server; a message sent on a robot's channel reaches its conversation and the reply appears on Discord
- [ ] Notifications reach Discord when enabled for the robot
- [ ] Gateway reconnects after a DO restart
