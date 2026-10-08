/**
 * Skills that come with the connectors (v1.5 ticket 07, cn-go3s, cn-6kh9): common flows for each
 * connector, and reading mBank's notification e-mails through Gmail. They are seeded into the Home's
 * skill library (the admin may edit them; a later seed never overwrites an edit) and a Robot loads
 * them only through a connector it is granted, never by an ordinary skill grant.
 */
import type { ConnectorKind } from '@mr-robot/protocol'

export interface ConnectorSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

const skill = (name: string, description: string, body: string): ConnectorSkill => ({
  name,
  description,
  content: '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n' + body.trim() + '\n',
})

const GOOGLE = skill('google-workspace', 'Triage a Gmail inbox, schedule a meeting, file an attachment into Drive, fill a Sheet.', `
# Google Workspace

Every tool names the account it acts on; when several accounts are granted, pass account.

## Triage the inbox
1. gmail_search with "is:unread in:inbox" (max 30).
2. For each thread worth a look, gmail_thread. Sort into: needs the owner (a question, a deadline, money), needs a reply you can draft, newsletters and notices.
3. Newsletters the owner never reads: gmail_unsubscribe, which also archives. Notices already handled: gmail_archive.
4. Replies: gmail_draft with replyTo set, so the owner sends them. Send only when the owner asked you to and you hold the write grant.
5. Report in a short list: what needs the owner first, then what you drafted, archived or unsubscribed.

## Schedule a meeting
1. calendar_freebusy for the owner (and attendees who share free/busy) over the days asked.
2. Propose two or three slots to the owner unless they told you to pick.
3. calendar_create with attendees (they get an invitation) and meet: true for a call. Use the owner's time zone.

## File an attachment
1. gmail_search to find the e-mail ("has:attachment invoice newer_than:30d").
2. gmail_attachment saves it to the Workspace (attachments/gmail/...).
3. drive_search for the target folder (or drive_create_folder), then drive_upload with folderId.
4. gmail_label the thread (e.g. "Filed") so it is not filed twice.

## Fill a spreadsheet
- sheets_info, then sheets_read the header row to learn the columns.
- sheets_append for new rows; sheets_write to change cells in place. Never re-upload a Sheet to edit it.
`)

const MBANK = skill('mbank-notifications', 'Report mBank balance and transactions from the bank\'s notification e-mails in Gmail, without logging in to the bank.', `
# mBank from its notification e-mails

The owner turns on e-mail notifications in mBank (transactions and balance). The bank then sends
an e-mail for each movement; this skill reads them. Never log in to the bank's website.

## Find the notifications
- gmail_search with "from:mbank.pl newer_than:7d" (widen to 30d for a monthly view). Notifications
  come from an mbank.pl address; subjects are Polish, e.g. "Powiadomienie", "Transakcja", "Saldo".
- If nothing comes back, try "mBank" alone, then tell the owner the notifications may be off.

## Read them
- gmail_thread on each result. Pull out, per e-mail: the date, the amount with its sign and currency
  (PLN), the counterparty or title ("Tytuł", "Odbiorca", "Nadawca", "Opis"), and the balance after it
  ("Saldo", "Dostępne środki") when the e-mail gives one.
- Amounts use a comma for decimals ("123,45 PLN"); keep them as written when you quote them.
- Quote only what the e-mails say. If an e-mail is unclear, say which one and show its text; never
  guess an amount or a balance.

## Report
- Balance: the latest balance from the most recent e-mail that carries one, with its date.
- Transactions: newest first, date, amount, counterparty/title. Sum outgoing and incoming separately.
- Point out what stands out: large payments, unknown counterparties, card payments abroad.
`)

const SLACK = skill('slack-workspace', 'Catch up on a Slack workspace: unread first, threads, replies with the write grant.', `
# Slack

## Catch up
1. slack_list_unreads: channels and DMs with unread messages, mentions first.
2. slack_read_channel for each (limit 30); slack_read_thread where a message has replies.
3. Summarise per channel: decisions, questions to the owner, things waiting on them. Mention who asked.
4. Do not mark anything read unless the owner asked; then slack_mark_read per channel (write grant).

## Answer
- Reply in the thread (slack_send_message with threadTs) rather than in the channel.
- Post only with the write grant and when the owner asked you to; quote what you will send first if
  it speaks for the owner.

## Find something
- slack_search_public_and_private with Slack search syntax ("from:@anna invoice", "in:#finance").
- slack_search_users / slack_read_user_profile to find a person and their e-mail.

If Slack says the session is gone, tell the owner to paste the token and cookie again on the Slack row.
`)

const DISCORD = skill('discord-bot', 'Use the Home\'s Discord bot: read and post in channels, reply, react, DM the owner.', `
# Discord

The bot posts as itself, never as the owner.

- discord_guilds, then discord_channels to find a channel id; discord_read_messages to read it.
- Answer with discord_reply so the reply points at the message; react with discord_react to
  acknowledge without noise.
- discord_dm reaches a person who shares a server with the bot (the owner's user id appears as the
  author of their messages).
- If your settings give you a Discord channel, messages there wake you and your replies go back there
  by themselves: you do not need to call discord_send_message to answer.
`)

export const CONNECTOR_SKILLS: Readonly<Record<ConnectorKind, readonly ConnectorSkill[]>> = {
  google: [GOOGLE, MBANK],
  slack: [SLACK],
  discord: [DISCORD],
}

export const CONNECTOR_SKILL_NAMES: ReadonlySet<string> = new Set(Object.values(CONNECTOR_SKILLS).flat().map((entry) => entry.name))
