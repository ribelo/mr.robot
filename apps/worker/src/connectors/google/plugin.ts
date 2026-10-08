/** The Google connector (v1.5): Gmail and Calendar (ticket 03); Drive, Docs, Sheets and Contacts (ticket 04). */
import { connectorTools, type ConnectorPlugin } from '../connector.ts'
import { calendarTools } from './calendar.ts'
import { gmailTools } from './gmail.ts'

export const GooglePlugin: ConnectorPlugin = {
  kind: 'google',
  tools: (host) => connectorTools(host, [...gmailTools(host), ...calendarTools(host)]),
  prompt: () => [
    '- Google: a tool appears only for the services the account granted. Prefer gmail_draft over sending when the owner did not ask you to send; a sent e-mail cannot be taken back.',
    '- Attachments you save land in your Workspace under attachments/gmail/; you can attach Workspace files to drafts and e-mails by path.',
  ].join('\n'),
}
