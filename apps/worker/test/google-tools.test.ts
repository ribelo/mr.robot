import { beforeEach, describe, expect, it } from 'vitest'
import { GooglePlugin } from '../src/connectors/google/plugin.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { account, b64url, decodeRaw, runTool, testHost } from './connector-host.ts'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const CAL = 'https://www.googleapis.com/calendar/v3'
const ANNA = account('google', 'Private', 'anna@gmail.test', ['gmail', 'gmail-send', 'calendar'], true)

beforeEach(() => connectorFixtures.reset())

const tools = (accounts = [ANNA]) => {
  const test = testHost('google', accounts)
  return { ...test, tools: GooglePlugin.tools(test.host) }
}
const json = (call: RecordedCall) => JSON.parse(call.body ?? 'null') as Record<string, unknown>
const callTo = (url: string, method = 'GET') => connectorFixtures.calls.find((call) => call.method === method && call.url.startsWith(url))!

// Recorded shapes of Gmail messages (users.messages resource).
const headers = (entries: Record<string, string>) => Object.entries(entries).map(([name, value]) => ({ name, value }))
const invoice = {
  id: 'm-1', threadId: 't-1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Your invoice for October', internalDate: '1791400000000',
  payload: {
    mimeType: 'multipart/mixed',
    headers: headers({ From: 'Shop <billing@shop.test>', To: 'anna@gmail.test', Cc: 'ben@home.test', Subject: 'Invoice 10/2026', Date: 'Wed, 07 Oct 2026 09:00:00 +0200', 'Message-ID': '<m1@shop.test>', 'List-Unsubscribe': '<https://shop.test/unsub?u=1>, <mailto:unsub@shop.test>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64url('Hello Anna,\r\nyour invoice is attached.\r\nTotal: 123,45 zł') } },
        { mimeType: 'text/html', body: { data: b64url('<p>Hello Anna</p>') } },
      ] },
      { mimeType: 'application/pdf', filename: 'invoice-10.pdf', body: { attachmentId: 'att-1', size: 2048 } },
    ],
  },
}

describe('Gmail tools against recorded responses (cn-426k, cn-z1di)', () => {
  it('gmail_search lists threads with their latest message', async () => {
    connectorFixtures.on('GET', `${GMAIL}/threads?`, { threads: [{ id: 't-1' }], resultSizeEstimate: 1 })
    connectorFixtures.on('GET', `${GMAIL}/threads/t-1?format=metadata`, { id: 't-1', messages: [invoice] })
    const { tools: list } = tools()
    const text = await runTool(list, 'gmail_search', { query: 'is:unread in:inbox', max: 5 })
    expect(text).toContain('[google · Private (anna@gmail.test)] search "is:unread in:inbox"')
    expect(new URL(callTo(`${GMAIL}/threads?`).url).searchParams.get('q')).toBe('is:unread in:inbox')
    expect(new URL(callTo(`${GMAIL}/threads?`).url).searchParams.get('maxResults')).toBe('5')
    expect(callTo(`${GMAIL}/threads?`).headers['authorization']).toBe('Bearer token-c-Private')
    const [thread] = JSON.parse(text.split('\n').slice(1).join('\n'))
    expect(thread).toMatchObject({ threadId: 't-1', unread: true, from: 'Shop <billing@shop.test>', subject: 'Invoice 10/2026', snippet: 'Your invoice for October', attachments: [{ attachmentId: 'att-1', filename: 'invoice-10.pdf' }] })
  })

  it('gmail_thread reads the plain text, or HTML without markup, and lists attachments', async () => {
    const htmlOnly = { ...invoice, id: 'm-2', payload: { mimeType: 'text/html', headers: headers({ From: 'news@shop.test', Subject: 'News' }), body: { data: b64url('<html><style>p{}</style><p>Sale &amp; more</p><a href="https://shop.test/x">here</a></html>') } } }
    connectorFixtures.on('GET', `${GMAIL}/threads/t-1?format=full`, { id: 't-1', messages: [invoice, htmlOnly] })
    const text = await runTool(tools().tools, 'gmail_thread', { threadId: 't-1' })
    const body = JSON.parse(text.split('\n').slice(1).join('\n'))
    expect(body.messages[0].text).toBe('Hello Anna,\nyour invoice is attached.\nTotal: 123,45 zł')
    expect(body.messages[0].attachments).toEqual([{ attachmentId: 'att-1', filename: 'invoice-10.pdf', mimeType: 'application/pdf', size: 2048 }])
    expect(body.messages[1].text).toBe('Sale & more\nhere (https://shop.test/x)')
  })

  it('gmail_attachment saves the file into the Workspace', async () => {
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1/attachments/att-1`, { data: b64url('%PDF-1.4 invoice'), size: 16 })
    const { tools: list, files } = tools()
    const text = await runTool(list, 'gmail_attachment', { messageId: 'm-1', attachmentId: 'att-1', filename: 'invoice/10.pdf' })
    const path = JSON.parse(text.split('\n').slice(1).join('\n')).path as string
    expect(path).toMatch(/^attachments\/gmail\/\d{4}-\d{2}-\d{2}\/invoice_10\.pdf$/)
    expect(new TextDecoder().decode(files.get(path))).toBe('%PDF-1.4 invoice')
  })

  it('gmail_draft builds a reply draft in the thread with a Workspace file attached', async () => {
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1?format=metadata`, invoice)
    connectorFixtures.on('POST', `${GMAIL}/drafts`, { id: 'd-1', message: { id: 'm-9', threadId: 't-1' } })
    const { tools: list, host } = tools()
    await host.saveFile('out/receipt.pdf', new TextEncoder().encode('%PDF receipt'))
    const text = await runTool(list, 'gmail_draft', { to: ['billing@shop.test'], subject: 'Re: Invoice 10/2026', body: 'Paid, receipt attached. Zażółć.', attachments: ['out/receipt.pdf'], replyTo: 'm-1' })
    expect(text).toContain('"draftId": "d-1"')
    const sent = json(callTo(`${GMAIL}/drafts`, 'POST')) as { message: { raw: string; threadId: string } }
    expect(sent.message.threadId).toBe('t-1')
    const mime = decodeRaw(sent.message.raw)
    expect(mime).toContain('To: billing@shop.test')
    expect(mime).toContain('In-Reply-To: <m1@shop.test>')
    expect(mime).toContain('Content-Disposition: attachment; filename="receipt.pdf"')
    expect(mime).toContain('Content-Type: application/pdf')
  })

  it('send, reply and forward exist only with the write grant; reply-all leaves the account out', async () => {
    const reader = account('google', 'Reader', 'anna@gmail.test', ['gmail', 'gmail-send', 'calendar'], false)
    expect(tools([reader]).tools.map((tool) => tool.name).filter((name) => /send|reply|forward/.test(name))).toEqual([])
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1?format=metadata`, invoice)
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-10', threadId: 't-1' })
    const { tools: list } = tools()
    const reply = await runTool(list, 'gmail_reply', { messageId: 'm-1', body: 'Thanks!', replyAll: true })
    expect(reply).toContain('"to": [')
    const sent = json(callTo(`${GMAIL}/messages/send`, 'POST')) as { raw: string; threadId: string }
    expect(sent.threadId).toBe('t-1')
    const mime = decodeRaw(sent.raw)
    expect(mime).toContain('To: Shop <billing@shop.test>')
    expect(mime).toContain('Cc: ben@home.test')
    expect(mime).not.toMatch(/Cc:.*anna@gmail\.test/)
    expect(mime).toContain('Subject: Re: Invoice 10/2026')
    expect(mime).toContain('References: <m1@shop.test>')
  })

  it('gmail_send encodes a UTF-8 subject; gmail_forward carries the original attachments', async () => {
    connectorFixtures.on('POST', `${GMAIL}/messages/send`, { id: 'm-11', threadId: 't-9' })
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1?format=full`, invoice)
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1/attachments/att-1`, { data: b64url('%PDF-1.4 invoice') })
    const { tools: list } = tools()
    await runTool(list, 'gmail_send', { to: ['ben@home.test'], subject: 'Rachunek za prąd', body: 'Zapłacone.' })
    expect(decodeRaw((json(connectorFixtures.calls.at(-1)!) as { raw: string }).raw)).toContain(`Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Rachunek za prąd')))}?=`)
    await runTool(list, 'gmail_forward', { messageId: 'm-1', to: ['accounting@firm.test'], note: 'For the books.' })
    const forwarded = decodeRaw((json(connectorFixtures.calls.at(-1)!) as { raw: string }).raw)
    expect(forwarded).toContain('Subject: Fwd: Invoice 10/2026')
    expect(forwarded).toContain('filename="invoice-10.pdf"')
  })

  it('labels by name (creating one when asked), archives and marks read through thread modify', async () => {
    connectorFixtures.on('GET', `${GMAIL}/labels`, { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'UNREAD', name: 'UNREAD', type: 'system' }] })
    connectorFixtures.on('POST', `${GMAIL}/labels`, { id: 'Label_7', name: 'Invoices' })
    connectorFixtures.on('POST', `${GMAIL}/threads/t-1/modify`, { id: 't-1' })
    const { tools: list } = tools()
    await runTool(list, 'gmail_label', { threadId: 't-1', add: ['Invoices'], remove: ['INBOX'], create: true })
    expect(json(callTo(`${GMAIL}/labels`, 'POST'))).toMatchObject({ name: 'Invoices' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] })
    await runTool(list, 'gmail_archive', { threadId: 't-1' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ addLabelIds: [], removeLabelIds: ['INBOX'] })
    await runTool(list, 'gmail_mark_read', { threadId: 't-1' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ addLabelIds: [], removeLabelIds: ['UNREAD'] })
    const missing = await runTool(list, 'gmail_label', { threadId: 't-1', add: ['Nope'] })
    expect(missing).toContain('Failed: No label "Nope"')
  })

  it('gmail_unsubscribe uses RFC 8058 one-click and archives the thread', async () => {
    connectorFixtures.on('GET', `${GMAIL}/messages/m-1?format=metadata`, invoice)
    connectorFixtures.on('POST', 'https://shop.test/unsub', new Response(null, { status: 200 }))
    connectorFixtures.on('POST', `${GMAIL}/threads/t-1/modify`, { id: 't-1' })
    const text = await runTool(tools().tools, 'gmail_unsubscribe', { messageId: 'm-1' })
    expect(text).toContain('"method": "one-click"')
    const post = callTo('https://shop.test/unsub', 'POST')
    expect(post.body).toBe('List-Unsubscribe=One-Click')
    expect(post.headers['authorization']).toBeUndefined()
  })

  it('a 401 is reported in the result and on the connection', async () => {
    connectorFixtures.on('GET', `${GMAIL}/labels`, { error: { code: 401, message: 'Request had invalid authentication credentials.' } }, 401)
    const { tools: list, statuses } = tools()
    const text = await runTool(list, 'gmail_labels', {})
    expect(text).toContain("Failed: the account's credentials were refused: Request had invalid authentication credentials.")
    expect(statuses).toEqual([{ id: 'c-Private', status: 'needs-reconsent', note: 'Request had invalid authentication credentials.' }])
  })
})

describe('Calendar tools against recorded responses (cn-s04t)', () => {
  const meeting = { id: 'e-1', status: 'confirmed', summary: 'Dentist', start: { dateTime: '2026-10-09T10:00:00+02:00' }, end: { dateTime: '2026-10-09T10:30:00+02:00' }, htmlLink: 'https://calendar.google.com/e-1', attendees: [{ email: 'anna@gmail.test', self: true, responseStatus: 'needsAction' }, { email: 'dr@clinic.test', responseStatus: 'accepted' }] }

  it('lists calendars and events with recurring events expanded in time order', async () => {
    connectorFixtures.on('GET', `${CAL}/users/me/calendarList`, { items: [{ id: 'anna@gmail.test', summary: 'Anna', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' }] })
    connectorFixtures.on('GET', `${CAL}/calendars/primary/events?`, { timeZone: 'Europe/Warsaw', items: [meeting] })
    const { tools: list } = tools()
    expect(await runTool(list, 'calendar_calendars', {})).toContain('"primary": true')
    const text = await runTool(list, 'calendar_events', { from: '2026-10-09T00:00:00+02:00', to: '2026-10-10T00:00:00+02:00', query: 'dentist' })
    const params = new URL(callTo(`${CAL}/calendars/primary/events?`).url).searchParams
    expect(Object.fromEntries(params)).toMatchObject({ timeMin: '2026-10-09T00:00:00+02:00', timeMax: '2026-10-10T00:00:00+02:00', q: 'dentist', singleEvents: 'true', orderBy: 'startTime' })
    expect(text).toContain('"summary": "Dentist"')
    expect(text).toContain('"you": true')
  })

  it('creates an all-day event and a timed one with attendees invited and a Meet link', async () => {
    connectorFixtures.on('POST', `${CAL}/calendars/primary/events`, (call: RecordedCall) => ({ id: 'e-new', ...json(call), htmlLink: 'https://calendar.google.com/e-new' }))
    const { tools: list } = tools()
    await runTool(list, 'calendar_create', { summary: 'Holiday', start: '2026-12-24', end: '2026-12-27' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ summary: 'Holiday', start: { date: '2026-12-24' }, end: { date: '2026-12-27' } })
    expect(new URL(connectorFixtures.calls.at(-1)!.url).searchParams.get('sendUpdates')).toBe('none')
    await runTool(list, 'calendar_create', { summary: 'Plan', start: '2026-10-12T10:00:00', end: '2026-10-12T11:00:00', timeZone: 'Europe/Warsaw', attendees: ['ben@home.test'], meet: true })
    const created = connectorFixtures.calls.at(-1)!
    expect(new URL(created.url).searchParams.get('sendUpdates')).toBe('all')
    expect(new URL(created.url).searchParams.get('conferenceDataVersion')).toBe('1')
    expect(json(created)).toMatchObject({ start: { dateTime: '2026-10-12T10:00:00', timeZone: 'Europe/Warsaw' }, attendees: [{ email: 'ben@home.test' }], conferenceData: { createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } } } })
  })

  it('updates only the given fields, deletes, answers an invitation as the account, and reads free/busy', async () => {
    connectorFixtures.on('PATCH', `${CAL}/calendars/primary/events/e-1`, (call: RecordedCall) => ({ ...meeting, ...json(call) }))
    connectorFixtures.on('GET', `${CAL}/calendars/primary/events/e-1`, meeting)
    connectorFixtures.on('DELETE', `${CAL}/calendars/primary/events/e-1`, new Response(null, { status: 204 }))
    connectorFixtures.on('POST', `${CAL}/freeBusy`, { calendars: { primary: { busy: [{ start: '2026-10-09T08:00:00Z', end: '2026-10-09T08:30:00Z' }] } } })
    const { tools: list } = tools()
    await runTool(list, 'calendar_update', { eventId: 'e-1', location: 'Clinic, room 2' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ location: 'Clinic, room 2' })
    expect(await runTool(list, 'calendar_delete', { eventId: 'e-1' })).toContain('"deleted": true')
    await runTool(list, 'calendar_respond', { eventId: 'e-1', response: 'accepted' })
    expect(json(connectorFixtures.calls.at(-1)!)).toEqual({ attendees: [{ email: 'anna@gmail.test', self: true, responseStatus: 'accepted' }, { email: 'dr@clinic.test', responseStatus: 'accepted' }] })
    const busy = await runTool(list, 'calendar_freebusy', { from: '2026-10-09T00:00:00Z', to: '2026-10-10T00:00:00Z' })
    expect(busy).toContain('2026-10-09T08:00:00Z')
    expect(json(connectorFixtures.calls.at(-1)!)).toMatchObject({ items: [{ id: 'primary' }] })
  })

  it('offers a service\'s tools only for accounts that granted it (cn-lzqh)', () => {
    const calendarOnly = account('google', 'Work', 'anna@work.test', ['calendar'])
    const names = tools([calendarOnly]).tools.map((tool) => tool.name)
    expect(names.some((name) => name.startsWith('gmail_'))).toBe(false)
    expect(names).toContain('calendar_create')
  })
})
