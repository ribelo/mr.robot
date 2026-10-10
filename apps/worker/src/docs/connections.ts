export const CONNECTIONS = `# Connections

A Connector is a plugin that gives Robots tools on an external service. A Connection is one linked account of a Connector. The Connectors are Google, Slack and Discord.

## Rules for all Connections

- A Connection belongs to the Member who linked it. It is private or shared with the Home.
- A Member can have many Connections of one kind.
- The owner grants a Connection to a Robot, one by one. Mr. Robot is the exception: he holds every Connection his owner can reach, unless the owner lowered one.
- Write access is a separate grant item: Connection write. A Robot can read with a read grant and cannot write.
- When a Member has more than one Connection of a kind, each tool takes an account argument. Without it, the tool uses the default Connection.
- A tool that fails throws an error. A tool that works returns JSON that names the account.
- Secrets stay in the vault. They never reach the Robot or the Conversation.

Read grants.md for the levels allow, ask and deny. A new Robot gets deny on Connections with write.

## Status

A Connection is connected, needs re-consent, or is rejected. The Member fixes it on the Plugins page.

## Google

The Home admin creates one OAuth client in Google Cloud and pastes it in the Google plugin settings. A guided page shows the steps. Then each Member links accounts with Connect Google. The Member chooses the services at that time. The services are Gmail, Calendar, Drive (with Docs and Sheets), and Contacts. Gmail send is a separate grant. The tool google_accounts lists the accounts and the services each one offers. Files from Google land in the Robot's Workspace.

## Discord

One bot belongs to the Home. The Member invites it to a Discord server. A Discord Connection shows its id next to its name. Discord is also a Channel. A message in a Robot's Discord channel or in a DM wakes the Robot. The Robot's reply goes to the same place.

## Slack

The Member pastes a session token and a cookie for a Slack workspace. The Robot can read by default. Write access needs the separate grant. When Slack rejects the session, the Connection asks the Member to paste it again.

## Skills for Connections

Each Connector has a SKILL.md in the Home library. The skill comes with the Connection grant.

## Plugins page

The Plugins page lists the plugins. The Home admin switches a plugin on or off for the Home. Each plugin has a detail page with its settings.
`
