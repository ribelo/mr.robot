/**
 * E-mail in and out of Gmail (v1.5 ticket 03): an RFC 5322 message with UTF-8 headers and attachments,
 * base64url as Gmail's raw format, and the readable text of a received message.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export const base64Url = (bytes: Uint8Array): string => base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function fromBase64Url(text: string): Uint8Array {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** A header value with non-ASCII text as an RFC 2047 encoded word. */
function headerText(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(encoder.encode(value))}?=`
}

/** Base64 body lines of at most 76 characters (RFC 2045). */
const wrapped = (bytes: Uint8Array): string => base64(bytes).replace(/.{76}/g, '$&\r\n')

export interface OutgoingMail {
  readonly from?: string
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject: string
  readonly body: string
  readonly inReplyTo?: string
  readonly references?: string
  readonly attachments?: ReadonlyArray<{ readonly name: string; readonly contentType: string; readonly bytes: Uint8Array }>
}

/** The message as Gmail's raw field expects it. */
export function buildMime(mail: OutgoingMail, boundary = `mr-robot-${crypto.randomUUID()}`): string {
  const headers = [
    ...(mail.from === undefined ? [] : [`From: ${mail.from}`]),
    `To: ${mail.to.join(', ')}`,
    ...(mail.cc === undefined || mail.cc.length === 0 ? [] : [`Cc: ${mail.cc.join(', ')}`]),
    ...(mail.bcc === undefined || mail.bcc.length === 0 ? [] : [`Bcc: ${mail.bcc.join(', ')}`]),
    `Subject: ${headerText(mail.subject)}`,
    ...(mail.inReplyTo === undefined ? [] : [`In-Reply-To: ${mail.inReplyTo}`]),
    ...(mail.references === undefined ? [] : [`References: ${mail.references}`]),
    'MIME-Version: 1.0',
  ]
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrapped(encoder.encode(mail.body))]
  const files = mail.attachments ?? []
  const message = files.length === 0
    ? [...headers, ...text].join('\r\n')
    : [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      ...text,
      ...files.flatMap((file) => [
        `--${boundary}`,
        `Content-Type: ${file.contentType}; name="${headerText(file.name)}"`,
        `Content-Disposition: attachment; filename="${headerText(file.name)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapped(file.bytes),
      ]),
      `--${boundary}--`,
    ].join('\r\n')
  return base64Url(encoder.encode(message))
}

/** A Gmail payload part, as far as reading needs it. */
export interface MessagePart {
  readonly mimeType?: string | undefined
  readonly filename?: string | undefined
  readonly headers?: ReadonlyArray<{ readonly name: string; readonly value: string }> | undefined
  readonly body?: { readonly data?: string | undefined; readonly attachmentId?: string | undefined; readonly size?: number | undefined } | undefined
  readonly parts?: readonly MessagePart[] | undefined
}

export const header = (part: MessagePart, name: string): string | undefined =>
  part.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value

function walk(part: MessagePart, visit: (part: MessagePart) => void): void {
  visit(part)
  for (const child of part.parts ?? []) walk(child, visit)
}

/** The readable text: the plain part, or the HTML part without its markup. */
export function messageText(payload: MessagePart): string {
  let plain: string | undefined
  let html: string | undefined
  walk(payload, (part) => {
    if (part.body?.data === undefined || (part.filename ?? '') !== '') return
    if (part.mimeType === 'text/plain' && plain === undefined) plain = decoder.decode(fromBase64Url(part.body.data))
    if (part.mimeType === 'text/html' && html === undefined) html = decoder.decode(fromBase64Url(part.body.data))
  })
  return (plain ?? (html === undefined ? '' : htmlToText(html))).replace(/\r\n/g, '\n').trim()
}

export function attachmentsOf(payload: MessagePart): Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> {
  const found: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = []
  walk(payload, (part) => {
    if ((part.filename ?? '') !== '' && part.body?.attachmentId !== undefined) found.push({ attachmentId: part.body.attachmentId, filename: part.filename!, mimeType: part.mimeType ?? 'application/octet-stream', size: part.body.size ?? 0 })
  })
  return found
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** HTML mail as plain text: block elements become line breaks, links keep their address. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => (label.replace(/<[^>]+>/g, '').trim() === href ? href : `${label} (${href})`))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
      if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
      return ENTITIES[entity.toLowerCase()] ?? match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A file name safe for the Workspace. */
export const safeName = (name: string): string => name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'attachment'
