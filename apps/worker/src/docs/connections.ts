export const CONNECTIONS = `# Connections

A Connector is a plugin that gives Robots tools on an external service. A Connection is one linked account of a Connector. The Connectors are Google, Slack, Discord as a bot and Discord as you.

## Rules for all Connections

- A Connection belongs to the Member who linked it.
- Google, Slack and Discord as you act as the Member. They are never shared with the Home: another Member's Robot must never act as the owner. They have no "Shared with the Home" checkbox. A Discord bot Connection is private or shared.
- A Member can have many Connections of one kind.
- The owner grants a Connection to a Robot, one by one. Mr. Robot is the exception: he holds every Connection his owner can reach, unless the owner lowered one.
- Write access is a separate grant item: Connection write. A Robot can read with a read grant and cannot write.
- A Robot's Advanced settings list one item per connected account, for example "Discord bot · Mr. Robot".
- When a Member has more than one Connection of a kind, each tool takes an account argument. Without it, the tool uses the default Connection.
- A tool that fails throws an error. A tool that works returns JSON that names the account.
- Secrets stay in the vault. They never reach the Robot or the Conversation.

Read grants.md for the levels allow, ask and deny. A new Robot gets deny on Connections with write.

## Status

The Member connects in the Connections section of the profile. A Connection is connected, needs consent again, or is rejected.
- A Google account that needs consent again shows Reconnect.
- A rejected Slack or Discord as you Connection shows "Sign in again". The Member signs in again in the same way as the first time.
- A rejected Discord bot shows "Paste again".

## Connect as you: Slack and Discord

Slack and Discord as you connect with the Member's own session. There are three ways:
- In the desktop app: Connect opens a sign-in window for the service. The Member signs in there. The app reads the session, connects it and closes the window.
- In the PWA: Connect opens Mr. Robot's browser on the sign-in page under Takeover. The Member signs in and hands the browser back. The platform reads the session, connects it, and discards the tab. The session lives only in the Connection.
- "Paste a session instead" is the fallback: the fields and the steps to copy the session from a browser.

If nobody signs in within 10 minutes, the attempt stops and nothing is connected. The session is never shown to the Member or to a Robot.

## Google

The Home admin pastes one Google Cloud OAuth client in the Google plugin settings (a guided page shows the steps). Each Member links accounts with Connect Google and chooses the services. The services are Gmail, Calendar, Drive (with Docs and Sheets), and Contacts. Gmail send is a separate grant. The tool google_accounts lists the accounts and the services each one offers. Files from Google land in the Robot's Workspace.

## Slack

Slack connects as you. The Robot can read by default: channels, unread messages, threads, search and people. Write access (post a message, mark read) needs the separate grant.

## Discord

Discord connects as a bot, as you, or both.

As a bot: one bot belongs to the Home. The Member invites it to a Discord server. A Discord bot Connection shows its id next to its name. Discord is also a Channel. A message in a Robot's Discord channel or in a DM wakes the Robot. The Robot's reply goes to the same place.

As you: the Member connects their own Discord account. Robots read the servers the Member is on: servers, channels, messages, threads, search and people. They read through Discord's REST API, so a Discord message does not wake a Robot through this Connection. The write tools (send, reply, react, mark read) need the Connection write grant. The connect form says: "Discord forbids automating a user account and may close it. You take that risk." The Member takes that risk knowingly.

## Drafts and sending

With the write grant at ask, a call of a send tool (Gmail send, reply, forward; Slack and Discord messages) is a draft. The owner reads it as the message, edits it, and sends exactly that or discards it with a reason. draft: true makes a draft at allow too; draft_revise changes an open one, and the card marks the changed words. "This Robot sends on its own" sets the write grant to allow. E-mail bodies are Markdown, sent as HTML with a plain-text part. gmail_draft leaves a draft in the mailbox instead.

## Instructions

The owner of a Connection can write instructions for it in Connections, for example "Sign as Anna. Never write to the board list.". Every Robot that holds the Connection at allow or ask reads them in the runtime section of its prompt. Mr. Robot sets them with connection_instructions_set.

## Skills for Connections

Each Connector has a SKILL.md in the Home library. The skill comes with the Connection grant.

## Plugins page

The Plugins page lists the plugins. The Home admin switches a plugin on or off for the Home. Each plugin has a detail page with its settings.
`
