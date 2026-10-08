# 06: Slack plugin with pasted session

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-3cnb, cn-clwd, cn-aljt, cn-bxmu

**What to build:** Connect a workspace by pasting xoxc token and d cookie (instructions in the row, from slkx); read tools (channels, unread, threads, search, users) by default; write tools (send, reply, mark read) behind a grant; rejected session reported as 'paste again' in place. Tool names follow the official Slack MCP as in Wiser's facade.

**Blocked by:** 01 Connector core, Plugins page, per-plugin settings rows

**Status:** ready-for-agent

- [ ] Live: unread list from the owner's workspace
- [ ] Write tools absent without the grant
- [ ] Invalid cookie shows 'paste again' on the row
