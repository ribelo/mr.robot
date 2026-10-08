/** The Google connector (v1.5): Gmail and Calendar (ticket 03); Drive, Docs, Sheets and Contacts (ticket 04). */
import { connectorTools, type ConnectorPlugin } from '../connector.ts'
import { calendarTools } from './calendar.ts'
import { gmailTools } from './gmail.ts'
import { driveTools } from './drive.ts'
import { docsSheetsTools } from './docs-sheets.ts'
import { contactsTools } from './contacts.ts'

export const GooglePlugin: ConnectorPlugin = {
  kind: 'google',
  tools: (host) => connectorTools(host, [...gmailTools(host), ...calendarTools(host), ...driveTools(host), ...docsSheetsTools(host), ...contactsTools(host)]),
  prompt: () => [
    '- Google: a tool appears only for the services the account granted. Prefer gmail_draft over sending when the owner did not ask you to send; a sent e-mail cannot be taken back.',
    '- Attachments you save land in your Workspace under attachments/gmail/, Drive downloads and exports under drive/; you can attach or upload Workspace files by path.',
    '- To fill a spreadsheet, write cells in place with sheets_write or sheets_append; to edit a document, use docs_replace or docs_append. Do not re-upload a file you can edit in place.',
  ].join('\n'),
}
