# Mr. Robot v1.5 — tickets

Spec: ../mr-robot-v1.5.md. 01 first; then 02 → 03, 04; 05 and 06 in parallel; 07 last; 08 postponed.

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 01 | [Connector core, Plugins page, per-plugin settings rows](01-connector-core-plugins-page-settings.md) | — | done |
| 02 | [Google: guided OAuth client setup and Connect Google](02-google-connect.md) | 01 | done |
| 03 | [Gmail and Calendar tools](03-gmail-calendar-tools.md) | 02 | done |
| 04 | [Drive, Docs, Sheets and Contacts tools](04-drive-docs-sheets-contacts-tools.md) | 02 | done |
| 05 | [Discord bot plugin and channel](05-discord-bot-and-channel.md) | 01 | in-progress (gateway, inbound and posting work live; a normal reply waits on the owner's Anthropic rate limit) |
| 06 | [Slack plugin with pasted session](06-slack-plugin.md) | 01 | in-progress (live unread list needs the owner's Slack paste) |
| 07 | [SKILL.md per connector and the mBank notifications skill](07-connector-skills-and-mbank.md) | 03, 05, 06 | in-progress (mBank report postponed by the owner; the rest done live) |
| 08 | [Bank data through a PSD2 aggregator (research)](08-psd2-research.md) | — | postponed |
