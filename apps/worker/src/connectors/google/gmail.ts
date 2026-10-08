/**
 * Gmail tools (v1.5 ticket 03, cn-426k, cn-z1di): search, read a thread, save attachments to the
 * Workspace, draft, send/reply/forward (write grant), label, archive, mark read, unsubscribe.
 * Names follow gogcli's gmail commands where they map to these scopes.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, request, type ConnectorHost, type ConnectorToolSpec } from '../connector.ts'
import { google, query } from './api.ts'
import { attachmentsOf, buildMime, fromBase64Url, header, messageText, safeName, type MessagePart } from './mime.ts'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const BODY_LIMIT = 20_000

interface PartShape extends MessagePart { readonly parts?: readonly PartShape[] | undefined }
const Part: Schema.Codec<PartShape> = Schema.Struct({
  mimeType: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))),
  body: Schema.optional(Schema.Struct({ data: Schema.optional(Schema.String), attachmentId: Schema.optional(Schema.String), size: Schema.optional(Schema.Number) })),
  parts: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<PartShape> => Part))),
}) as never

const Message = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  labelIds: Schema.optional(Schema.Array(Schema.String)),
  snippet: Schema.optional(Schema.String),
  internalDate: Schema.optional(Schema.String),
  payload: Schema.optional(Part),
})
type Message = typeof Message.Type
const Thread = Schema.Struct({ id: Schema.String, messages: Schema.optional(Schema.Array(Message)) })
const ThreadList = Schema.Struct({ threads: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String }))), nextPageToken: Schema.optional(Schema.String), resultSizeEstimate: Schema.optional(Schema.Number) })
const Labels = Schema.Struct({ labels: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.optional(Schema.String) }))) })
const Label = Schema.Struct({ id: Schema.String, name: Schema.String })
const Sent = Schema.Struct({ id: Schema.String, threadId: Schema.optional(Schema.String), labelIds: Schema.optional(Schema.Array(Schema.String)) })
const Draft = Schema.Struct({ id: Schema.String, message: Schema.optional(Schema.Struct({ id: Schema.String, threadId: Schema.optional(Schema.String) })) })
const AttachmentBody = Schema.Struct({ data: Schema.String, size: Schema.optional(Schema.Number) })
const Ignored = Schema.Unknown

/** One message as the model reads it. */
function summary(message: Message, withBody: boolean) {
  const payload = message.payload ?? {}
  const body = withBody ? messageText(payload) : undefined
  return {
    id: message.id,
    from: header(payload, 'From') ?? '',
    to: header(payload, 'To') ?? '',
    ...(header(payload, 'Cc') === undefined ? {} : { cc: header(payload, 'Cc') }),
    subject: header(payload, 'Subject') ?? '',
    date: header(payload, 'Date') ?? (message.internalDate === undefined ? '' : new Date(Number(message.internalDate)).toISOString()),
    unread: message.labelIds?.includes('UNREAD') ?? false,
    labels: message.labelIds ?? [],
    ...(withBody ? { text: body!.length > BODY_LIMIT ? `${body!.slice(0, BODY_LIMIT)}\n[… ${body!.length - BODY_LIMIT} more characters]` : body } : { snippet: message.snippet ?? '' }),
    attachments: attachmentsOf(payload),
  }
}

/** Label names to ids; names that do not exist yet are created when asked to. */
function labelIds(host: ConnectorHost, use: Parameters<typeof google>[1], names: readonly string[], create: boolean) {
  return Effect.gen(function* () {
    if (names.length === 0) return [] as string[]
    const known = (yield* google(host, use, { method: 'GET', url: `${GMAIL}/labels` }, Labels)).labels ?? []
    const ids: string[] = []
    for (const name of names) {
      const found = known.find((label) => label.name.toLowerCase() === name.toLowerCase() || label.id === name)
      if (found !== undefined) { ids.push(found.id); continue }
      if (!create) return yield* new ConnectorRefused({ message: `No label "${name}". Labels: ${known.map((label) => label.name).join(', ')}` })
      ids.push((yield* google(host, use, { method: 'POST', url: `${GMAIL}/labels`, json: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } }, Label)).id)
    }
    return ids
  })
}

const modifyThread = (host: ConnectorHost, use: Parameters<typeof google>[1], threadId: string, add: readonly string[], remove: readonly string[]) =>
  google(host, use, { method: 'POST', url: `${GMAIL}/threads/${encodeURIComponent(threadId)}/modify`, json: { addLabelIds: add, removeLabelIds: remove } }, Ignored)

const getMessage = (host: ConnectorHost, use: Parameters<typeof google>[1], id: string, format: 'full' | 'metadata') =>
  google(host, use, { method: 'GET', url: `${GMAIL}/messages/${encodeURIComponent(id)}${query({ format })}` }, Message)

/** Workspace files as attachments of an outgoing message. */
const filesOf = (host: ConnectorHost, paths: readonly string[] | undefined) => Effect.forEach(paths ?? [], (path) => Effect.tryPromise({
  try: async () => ({ name: path.split('/').at(-1) ?? path, contentType: contentTypeOf(path), bytes: await host.readFile(path) }),
  catch: (error) => new ConnectorRefused({ message: `cannot attach ${path}: ${error instanceof Error ? error.message : String(error)}` }),
}))

function contentTypeOf(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', html: 'text/html', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip: 'application/zip' } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' && value.trim() !== '' ? value.split(',').map((item) => item.trim()) : [])

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')

export function gmailTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'gmail_search',
      service: 'gmail',
      description: 'Search the mailbox with Gmail search syntax (e.g. "is:unread in:inbox", "from:bank newer_than:7d", "has:attachment invoice"). Returns threads newest first: id, latest message from, subject, date, snippet, unread, labels, attachments.',
      parameters: { properties: { query: { type: 'string' }, max: { type: 'number', description: 'At most this many threads (default 20, up to 50).' } }, required: ['query'] },
      action: (args) => `search "${str(args, 'query')}"`,
      run: (args, use) => Effect.gen(function* () {
        const max = Math.min(Math.max(Number(args['max'] ?? 20) || 20, 1), 50)
        const found = yield* google(host, use, { method: 'GET', url: `${GMAIL}/threads${query({ q: str(args, 'query'), maxResults: max })}` }, ThreadList)
        const threads = yield* Effect.forEach(found.threads ?? [], (thread) => google(host, use, { method: 'GET', url: `${GMAIL}/threads/${encodeURIComponent(thread.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date` }, Thread), { concurrency: 5 })
        return threads.map((thread) => {
          const messages = thread.messages ?? []
          const latest = messages.at(-1)
          return { threadId: thread.id, messages: messages.length, unread: messages.some((message) => message.labelIds?.includes('UNREAD')), ...(latest === undefined ? {} : summary(latest, false)) }
        })
      }),
    },
    {
      name: 'gmail_thread',
      service: 'gmail',
      description: 'Read a whole thread: every message with from, to, date, subject, its text and its attachments (ids and names for gmail_attachment).',
      parameters: { properties: { threadId: { type: 'string' } }, required: ['threadId'] },
      action: (args) => `read thread ${str(args, 'threadId')}`,
      run: (args, use) => Effect.map(google(host, use, { method: 'GET', url: `${GMAIL}/threads/${encodeURIComponent(str(args, 'threadId'))}?format=full` }, Thread), (thread) => ({ threadId: thread.id, messages: (thread.messages ?? []).map((message) => summary(message, true)) })),
    },
    {
      name: 'gmail_attachment',
      service: 'gmail',
      description: 'Save an attachment of a message into your Workspace under attachments/gmail/; returns its path.',
      parameters: { properties: { messageId: { type: 'string' }, attachmentId: { type: 'string' }, filename: { type: 'string' } }, required: ['messageId', 'attachmentId', 'filename'] },
      action: (args) => `save attachment "${str(args, 'filename')}"`,
      run: (args, use) => Effect.gen(function* () {
        const body = yield* google(host, use, { method: 'GET', url: `${GMAIL}/messages/${encodeURIComponent(str(args, 'messageId'))}/attachments/${encodeURIComponent(str(args, 'attachmentId'))}` }, AttachmentBody)
        const bytes = fromBase64Url(body.data)
        const path = `attachments/gmail/${new Date().toISOString().slice(0, 10)}/${safeName(str(args, 'filename'))}`
        yield* Effect.promise(() => host.saveFile(path, bytes))
        return { path, size: bytes.length }
      }),
    },
    {
      name: 'gmail_draft',
      service: 'gmail',
      description: 'Create a draft (not sent): to, cc, subject, body, optional Workspace files as attachments, optional replyTo message id to draft a reply in its thread. The owner can review and send it in Gmail.',
      parameters: { properties: { to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' }, attachments: { type: 'array', items: { type: 'string' }, description: 'Workspace paths.' }, replyTo: { type: 'string' } }, required: ['to', 'subject', 'body'] },
      action: (args) => `draft "${str(args, 'subject')}" to ${list(args['to']).join(', ')}`,
      run: (args, use) => Effect.gen(function* () {
        const reply = str(args, 'replyTo') === '' ? undefined : yield* getMessage(host, use, str(args, 'replyTo'), 'metadata')
        const files = yield* filesOf(host, list(args['attachments']))
        const messageId = reply?.payload === undefined ? undefined : header(reply.payload, 'Message-ID')
        const raw = buildMime({ to: list(args['to']), cc: list(args['cc']), subject: str(args, 'subject'), body: str(args, 'body'), attachments: files, ...(messageId === undefined ? {} : { inReplyTo: messageId, references: messageId }) })
        const draft = yield* google(host, use, { method: 'POST', url: `${GMAIL}/drafts`, json: { message: { raw, ...(reply === undefined ? {} : { threadId: reply.threadId }) } } }, Draft)
        return { draftId: draft.id, threadId: draft.message?.threadId ?? null }
      }),
    },
    {
      name: 'gmail_send',
      service: 'gmail',
      write: true,
      description: 'Send an e-mail now: to, cc, bcc, subject, body, optional Workspace files as attachments. Prefer gmail_draft when the owner should check it first.',
      parameters: { properties: { to: { type: 'array', items: { type: 'string' } }, cc: { type: 'array', items: { type: 'string' } }, bcc: { type: 'array', items: { type: 'string' } }, subject: { type: 'string' }, body: { type: 'string' }, attachments: { type: 'array', items: { type: 'string' } } }, required: ['to', 'subject', 'body'] },
      action: (args) => `send "${str(args, 'subject')}" to ${list(args['to']).join(', ')}`,
      run: (args, use) => Effect.gen(function* () {
        const files = yield* filesOf(host, list(args['attachments']))
        const sent = yield* google(host, use, { method: 'POST', url: `${GMAIL}/messages/send`, json: { raw: buildMime({ to: list(args['to']), cc: list(args['cc']), bcc: list(args['bcc']), subject: str(args, 'subject'), body: str(args, 'body'), attachments: files }) } }, Sent)
        return { sent: true, messageId: sent.id, threadId: sent.threadId ?? null }
      }),
    },
    {
      name: 'gmail_reply',
      service: 'gmail',
      write: true,
      description: 'Reply in the thread of a message, to its sender (or to everyone with replyAll); optional Workspace files as attachments.',
      parameters: { properties: { messageId: { type: 'string' }, body: { type: 'string' }, replyAll: { type: 'boolean' }, attachments: { type: 'array', items: { type: 'string' } } }, required: ['messageId', 'body'] },
      action: (args) => `reply to message ${str(args, 'messageId')}${args['replyAll'] === true ? ' (all)' : ''}`,
      run: (args, use, account) => Effect.gen(function* () {
        const original = yield* getMessage(host, use, str(args, 'messageId'), 'metadata')
        const payload = original.payload ?? {}
        const from = header(payload, 'Reply-To') ?? header(payload, 'From') ?? ''
        const others = args['replyAll'] === true ? [header(payload, 'To') ?? '', header(payload, 'Cc') ?? ''].flatMap((line) => line.split(',')).map((item) => item.trim()).filter((item) => item !== '' && !item.toLowerCase().includes(account.account.toLowerCase())) : []
        const subject = header(payload, 'Subject') ?? ''
        const id = header(payload, 'Message-ID')
        const files = yield* filesOf(host, list(args['attachments']))
        const raw = buildMime({ to: [from], cc: others, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, body: str(args, 'body'), attachments: files, ...(id === undefined ? {} : { inReplyTo: id, references: [header(payload, 'References'), id].filter(Boolean).join(' ') }) })
        const sent = yield* google(host, use, { method: 'POST', url: `${GMAIL}/messages/send`, json: { raw, threadId: original.threadId } }, Sent)
        return { sent: true, to: [from, ...others], messageId: sent.id, threadId: original.threadId }
      }),
    },
    {
      name: 'gmail_forward',
      service: 'gmail',
      write: true,
      description: 'Forward a message with its text and attachments to new recipients, with an optional note above it.',
      parameters: { properties: { messageId: { type: 'string' }, to: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['messageId', 'to'] },
      action: (args) => `forward message ${str(args, 'messageId')} to ${list(args['to']).join(', ')}`,
      run: (args, use) => Effect.gen(function* () {
        const original = yield* getMessage(host, use, str(args, 'messageId'), 'full')
        const payload = original.payload ?? {}
        const files = yield* Effect.forEach(attachmentsOf(payload), (file) => Effect.map(
          google(host, use, { method: 'GET', url: `${GMAIL}/messages/${encodeURIComponent(original.id)}/attachments/${encodeURIComponent(file.attachmentId)}` }, AttachmentBody),
          (body) => ({ name: file.filename, contentType: file.mimeType, bytes: fromBase64Url(body.data) }),
        ))
        const quoted = ['---------- Forwarded message ---------', `From: ${header(payload, 'From') ?? ''}`, `Date: ${header(payload, 'Date') ?? ''}`, `Subject: ${header(payload, 'Subject') ?? ''}`, `To: ${header(payload, 'To') ?? ''}`, '', messageText(payload)].join('\n')
        const subject = header(payload, 'Subject') ?? ''
        const sent = yield* google(host, use, { method: 'POST', url: `${GMAIL}/messages/send`, json: { raw: buildMime({ to: list(args['to']), subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`, body: `${str(args, 'note')}\n\n${quoted}`.trim(), attachments: files }) } }, Sent)
        return { sent: true, messageId: sent.id, attachments: files.length }
      }),
    },
    {
      name: 'gmail_labels',
      service: 'gmail',
      description: 'List the mailbox labels (system and your own).',
      parameters: { properties: {} },
      action: () => 'list labels',
      run: (_args, use) => Effect.map(google(host, use, { method: 'GET', url: `${GMAIL}/labels` }, Labels), (body) => (body.labels ?? []).map((label) => ({ id: label.id, name: label.name, type: label.type ?? 'user' }))),
    },
    {
      name: 'gmail_label',
      service: 'gmail',
      description: 'Add and remove labels on a thread by name; names that do not exist are created when create is true.',
      parameters: { properties: { threadId: { type: 'string' }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } }, create: { type: 'boolean' } }, required: ['threadId'] },
      action: (args) => `label thread ${str(args, 'threadId')}: +${list(args['add']).join(',') || '-'} -${list(args['remove']).join(',') || '-'}`,
      run: (args, use) => Effect.gen(function* () {
        const add = yield* labelIds(host, use, list(args['add']), args['create'] === true)
        const remove = yield* labelIds(host, use, list(args['remove']), false)
        yield* modifyThread(host, use, str(args, 'threadId'), add, remove)
        return { done: true }
      }),
    },
    {
      name: 'gmail_archive',
      service: 'gmail',
      description: 'Archive a thread (take it out of the inbox; nothing is deleted).',
      parameters: { properties: { threadId: { type: 'string' } }, required: ['threadId'] },
      action: (args) => `archive thread ${str(args, 'threadId')}`,
      run: (args, use) => Effect.as(modifyThread(host, use, str(args, 'threadId'), [], ['INBOX']), { archived: true }),
    },
    {
      name: 'gmail_mark_read',
      service: 'gmail',
      description: 'Mark a thread read (or unread with read: false).',
      parameters: { properties: { threadId: { type: 'string' }, read: { type: 'boolean' } }, required: ['threadId'] },
      action: (args) => `mark thread ${str(args, 'threadId')} ${args['read'] === false ? 'unread' : 'read'}`,
      run: (args, use) => Effect.as(args['read'] === false ? modifyThread(host, use, str(args, 'threadId'), ['UNREAD'], []) : modifyThread(host, use, str(args, 'threadId'), [], ['UNREAD']), { done: true }),
    },
    {
      name: 'gmail_unsubscribe',
      service: 'gmail',
      description: 'Unsubscribe from the mailing list a message came from, through its List-Unsubscribe header (one-click when the sender supports it). Archives the thread afterwards.',
      parameters: { properties: { messageId: { type: 'string' } }, required: ['messageId'] },
      action: (args) => `unsubscribe via message ${str(args, 'messageId')}`,
      run: (args, use) => Effect.gen(function* () {
        const message = yield* getMessage(host, use, str(args, 'messageId'), 'metadata')
        const payload = message.payload ?? {}
        const links = (header(payload, 'List-Unsubscribe') ?? '').match(/<[^>]+>/g)?.map((link) => link.slice(1, -1)) ?? []
        const web = links.find((link) => link.startsWith('https://'))
        const oneClick = /One-Click/i.test(header(payload, 'List-Unsubscribe-Post') ?? '')
        if (web !== undefined && oneClick) {
          // RFC 8058 one-click: a POST with this exact body, no cookies, no page to fill.
          yield* request(host.fetch, { method: 'POST', url: web, form: { 'List-Unsubscribe': 'One-Click' } }, Ignored)
          yield* modifyThread(host, use, message.threadId, [], ['INBOX'])
          return { unsubscribed: true, method: 'one-click', archived: true }
        }
        const mail = links.find((link) => link.startsWith('mailto:'))
        if (links.length === 0) return yield* new ConnectorRefused({ message: 'This message has no List-Unsubscribe header; look for an unsubscribe link in its text.' })
        return { unsubscribed: false, note: 'The sender has no one-click unsubscribe. Open the link in the browser, or send the e-mail it names.', ...(web === undefined ? {} : { link: web }), ...(mail === undefined ? {} : { mailto: mail }) }
      }),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}

