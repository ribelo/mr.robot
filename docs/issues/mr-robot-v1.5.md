---
title: "Mr. Robot v1.5 — connectors as plugins: Google, Discord, Slack"
status: ready-for-agent
story-prefix: cn
parent: mr-robot-v1.4.md
---

# Mr. Robot v1.5

## Problem Statement

Robots cannot touch the places where the owner's life happens: Gmail, Google Calendar, Google Drive, Contacts, Slack and Discord. Without them Mr. Robot has no purpose. The owner wants these as Cordis plugins (everything is a plugin), with configuration per plugin as in the DeepSeek Harness settings, with the simplest possible setup, no OAuth where a pasted browser session works (Slack), official OAuth where nothing else works (Google), an official bot where a user token risks the account (Discord), and no Go binaries or MCP servers in the Worker. His own earlier tools (slkx for Slack, gogcli for Google) are references to rewrite, not to run.

## Solution

A connector core: connections per Member (shareable with the Home), granted per robot, secrets in the vault, configuration derived from each plugin's schema, a Plugins page and per-plugin settings rows as in DSH. On it: a Google plugin (one-time guided OAuth client setup, Connect Google per account, Gmail, Calendar, Drive with Docs and Sheets editing, Contacts), a Discord plugin (bot; also a channel of Mr. Robot), a Slack plugin (pasted session, read by default, write on grant). A SKILL.md per connector and a skill for reading mBank notifications through Gmail. Nothing else: no Outlook, no Plaid, no CLIs.

## User Stories

### Plugins and their settings

1. As a Home admin, I want a Plugins page listing every plugin with a description and an on/off switch, as the DeepSeek Harness has, so that I see and control what the platform can do ^cn-dbm9
2. As a person, I want a settings page with one row per plugin (status, Connect/Manage), derived from each plugin's config schema, so that configuration is per plugin and not a separate form per feature ^cn-s1pd
3. As a person, I want a plugin's secrets (tokens, keys, pasted cookies) stored in my vault and referenced from its configuration, so that configuration never contains a secret ^cn-a1i0
4. As a person, I want a connection (a Google account, a Slack workspace, a Discord bot) to be mine, optionally shared with the Home, so that my partner can use the household Discord but not my Gmail ^cn-qs78
5. As a person, I want each connection granted per robot, so that the invoice robot reads one mailbox and nothing else ^cn-xezx
6. As a person, I want to link several accounts of one kind (private and company Google), so that a robot can be told which one to use ^cn-bsge
7. As a robot, I want each connector's tools to name the account they act on, so that I never act on the wrong mailbox ^cn-f6ux

### Google

8. As a Home admin, I want a guided one-time setup for the Google OAuth client (project, APIs, consent screen, client id and secret pasted into Mr. Robot), so that the only hard step is done once with instructions in front of me ^cn-fpyt
9. As a person, I want to connect a Google account with one 'Connect Google' button that ends back in Mr. Robot, so that no CLI or file is involved ^cn-aq2a
10. As a person, I want to choose at connect time which services the account grants (Gmail, Calendar, Drive, Contacts), so that a robot cannot get more than I gave ^cn-lzqh
11. As a robot, I want Gmail tools: search, read a thread, list and open attachments, draft, send, reply, forward, label, archive, mark read, unsubscribe, so that I can run a mailbox ^cn-426k
12. As a person, I want Gmail sending to be a separate grant from reading, so that a reading robot cannot send ^cn-z1di
13. As a robot, I want Calendar tools: list calendars, list and search events, create, update, delete, respond to invitations, free-busy, so that I can manage a calendar ^cn-s04t
14. As a robot, I want Drive tools: list and search, download, upload, create folders, move, share, export Docs and Sheets to text or CSV and import back, so that I can handle files ^cn-9mzm
15. As a robot, I want Docs and Sheets tools to read and edit document text and sheet cells in place, so that I can fill a spreadsheet without re-uploading it ^cn-pcf6
16. As a robot, I want Contacts tools: search and read contacts, so that I can find a person's address or phone ^cn-0c23
17. As a robot, I want Google access tokens refreshed for me without the owner, so that a routine at night works ^cn-j1la
18. As a person, I want to see when a Google connection needs re-consent and to fix it with one click, so that an expired token is not a mystery ^cn-9s7r

### Discord

19. As a Home admin, I want a guided setup for a Discord bot (create the application, copy the token, invite it to my server), so that the setup is one page ^cn-csae
20. As a robot, I want Discord tools: list channels, read messages, send messages and files, react, read and send DMs with the owner, so that I can talk on Discord ^cn-q259
21. As a person, I want Discord as a channel of Mr. Robot: a message I send to a robot's Discord channel or DM reaches its conversation and its replies and notifications go back there, so that I can talk to robots from Discord ^cn-65gg
22. As a person, I want a mapping of robots to Discord channels (one channel per robot by default), so that each robot has its place ^cn-y1ac

### Slack

23. As a person, I want to connect a Slack workspace by pasting the browser token and cookie with instructions in the UI, so that no app registration or OAuth is needed ^cn-3cnb
24. As a robot, I want Slack read tools: channels, unread, threads, search, user lookup, so that I can keep up with a workspace ^cn-clwd
25. As a robot, I want Slack write tools (send, reply in thread, mark read) behind a separate grant, so that a reading robot cannot post ^cn-aljt
26. As a person, I want a rejected Slack session reported with 'paste again here', so that a rotation is a one-step fix ^cn-bxmu

### Skills and bank

27. As a robot, I want a SKILL.md per connector describing common flows (triage inbox, schedule a meeting, file an attachment), so that I use the tools well ^cn-go3s
28. As a person, I want a skill that reads mBank's e-mail notifications through Gmail (balance, transactions), so that a robot knows my account without logging in to the bank ^cn-6kh9
29. As a person, I want connector calls visible in the trajectory with account and action, so that I can see what was sent where ^cn-07jo

## Implementation Decisions

### Connector core
- A connection: kind (google, slack, discord), owner Member, label, scope (private or Home), granted services (for Google), status (connected, needs re-consent, rejected), secret references into the vault. Any number per kind per Member. Granted per robot per connection like login entries; Mr. Robot exempt.
- Each connector is a Cordis plugin with a Schemastery config; the settings page renders one row per plugin from the schema with status and Connect/Manage, as in docs/reference/11; a Plugins page lists plugins with on/off per Home, as in docs/reference/12; opening a plugin shows its detail page (icon, name, description, a form derived from its config schema, Save), as in docs/reference/13. Secret fields are credential references resolved from the Member's vault at each call, never cached across turns.
- Every tool takes an account parameter when the Member has more than one connection of that kind; the default is the Member's marked default.
- HTTP through Effect HttpClient with Schema-typed responses; rate limits and retries per connector; every call recorded in the trajectory with account and action, secrets masked.
- Reference behaviour for tool naming and coverage: Slack mirrors the official Slack MCP tool names (as Wiser's facade does); Google mirrors gogcli's command surface where it maps to the chosen scopes; Discord mirrors the Discord REST resources used.

### Google
- OAuth 2.0 web flow owned by the edge Worker: the admin creates one OAuth client in Google Cloud (guided page with the exact steps: project, enable Gmail/Calendar/Drive/Docs/Sheets/People APIs, consent screen in production mode, web client with Mr. Robot's callback URL) and pastes client id and secret into the Google plugin settings (secret into the vault). Each Member connects accounts with incremental scopes chosen at connect time; refresh tokens stored in the vault; refresh without the owner; re-consent surfaced as a status with a one-click fix.
- Scopes: gmail.modify (+ gmail.send as a separate grant), calendar, drive, documents, spreadsheets, contacts.readonly.
- Tools as in the stories; attachments land in the robot's workspace.

### Discord
- One bot per Home (token in the vault), invited to the owner's server with the guided page. Gateway connection kept by a Durable Object (Discord requires a WebSocket for receiving); REST for sending. Channel adapter (v1 seam): inbound messages on a robot's channel or DM become wake-ups; replies and notifications go to the channel the message came from; robot↔channel mapping in the robot's settings, one channel per robot created on demand.

### Slack
- Pasted xoxc token and d cookie per workspace (instructions in the row, as slkx documents); read tools by default, write tools behind a separate grant; a rejected session sets the connection to 'paste again' with the instruction in place. No OAuth path.

### Skills
- SKILL.md per connector in the Home library, granted with the connector; an mBank-notifications skill that uses Gmail search and reading to report balance and transactions from the bank's notification e-mails (the owner enables the notifications in mBank).

## Testing Decisions
1. **Robot DO API** with fake connector HTTP: connections, sharing, grants, account routing, trajectory records, masked secrets, token refresh and re-consent states (cn-dbm9, cn-s1pd, cn-a1i0, cn-qs78, cn-xezx, cn-bsge, cn-f6ux, cn-j1la, cn-9s7r, cn-07jo).
2. **Connector plugins against recorded HTTP fixtures** (no network in tests): each tool's request and parsing for Google, Discord, Slack (cn-426k, cn-z1di, cn-s04t, cn-9mzm, cn-pcf6, cn-0c23, cn-q259, cn-clwd, cn-aljt).
3. **Live, manual, with the owner's accounts**: Google client setup page and Connect Google, a Gmail triage, a calendar event, a Drive upload and Docs edit; Discord bot setup, a message both ways, the channel; Slack paste and unread list; mBank skill on real notifications (cn-fpyt, cn-aq2a, cn-lzqh, cn-csae, cn-q259, cn-65gg, cn-y1ac, cn-3cnb, cn-bxmu, cn-go3s, cn-6kh9).

## Out of Scope
Outlook and Microsoft 365; Plaid and PSD2 aggregators (postponed research ticket); CLIs; MCP servers; Google Slides, Forms, Tasks; Telegram; Scanye, Allegro API, GitHub, couriers, maps (the owner declined them for now).

## Further Notes
- Fact base: Google has no cookie-based path that survives; gogcli and Muse both use OAuth with a registered client. Slack browser sessions work (slkx, Wiser). Discord user tokens violate the ToS and get accounts banned; a bot is official and simpler.
- References: docs/reference/11-dsh-settings-general.png, 12-dsh-plugins-page.webp; Wiser packages/facades/src/slack.ts for the Slack surface; ~/projects/ribelo/slkx for the paste flow; openclaw/gogcli for the Google command surface.
