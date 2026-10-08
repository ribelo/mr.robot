# 06: Slack plugin with pasted session

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-3cnb, cn-clwd, cn-aljt, cn-bxmu

**What to build:** Connect a workspace by pasting xoxc token and d cookie (instructions in the row, from slkx); read tools (channels, unread, threads, search, users) by default; write tools (send, reply, mark read) behind a grant; rejected session reported as 'paste again' in place. Tool names follow the official Slack MCP as in Wiser's facade.

**Blocked by:** 01 Connector core, Plugins page, per-plugin settings rows

**Status:** in-progress

- [ ] Live: unread list from the owner's workspace
- [ ] Write tools absent without the grant
- [ ] Invalid cookie shows 'paste again' on the row

## How it works

- **Connect:** Connections → Slack shows slkx's steps (the token from localConfig_v2, cookie d). The pair is checked with auth.test before it is stored, and the workspace's domain and name become the account.
- **Calls:** POST to slack.com/api with Bearer xoxc and Cookie d=xoxd, as slkx does. Slack's `{"ok":false,"error":"invalid_auth"}` (sent with HTTP 200) and the other session errors mark the connection **Paste again**; other refusals read as their own message.
- **Read tools** (names from the official Slack MCP as in Wiser's facade): slack_list_unreads (client.counts, as slkx), slack_list_user_channels, slack_read_channel and slack_read_thread (with people's names), slack_search_channels, slack_search_users, slack_read_user_profile, slack_search_public_and_private (search.messages).
- **Write tools, write grant only:** slack_send_message (a reply in a thread with threadTs) and slack_mark_read (conversations.mark).

## Verified

- **slack.test.ts:** every tool against recorded Slack answers, the exact headers, the write-grant gate, "paste again" on invalid_auth, a channel_not_found that does not mark the session, and connecting through auth.test (a wrong paste is refused and nothing is stored).
- **Open, needs the owner's paste:** the live unread list.
- **Unknown until live:** whether search.messages accepts a browser session; if Slack refuses it, the tool says so and the other read tools still work.
