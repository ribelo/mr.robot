/**
 * Drive tools (v1.5 ticket 04, cn-9mzm): search, download, upload, folders, move, share, export Docs
 * and Sheets to text or CSV and import files back as Docs or Sheets. Files move through the Workspace.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, type ConnectorHost, type ConnectorToolSpec } from '../connector.ts'
import { google, googleBytes, query } from './api.ts'
import { safeName } from './mime.ts'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FIELDS = 'id,name,mimeType,modifiedTime,size,parents,webViewLink,owners(emailAddress)'

export const DOC = 'application/vnd.google-apps.document'
export const SHEET = 'application/vnd.google-apps.spreadsheet'
const FOLDER = 'application/vnd.google-apps.folder'

const File = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  modifiedTime: Schema.optional(Schema.String),
  size: Schema.optional(Schema.String),
  parents: Schema.optional(Schema.Array(Schema.String)),
  webViewLink: Schema.optional(Schema.String),
  owners: Schema.optional(Schema.Array(Schema.Struct({ emailAddress: Schema.optional(Schema.String) }))),
})
type File = typeof File.Type
const Files = Schema.Struct({ files: Schema.Array(File), nextPageToken: Schema.optional(Schema.String) })
const Permission = Schema.Struct({ id: Schema.String, role: Schema.String })

const shown = (file: File) => ({
  id: file.id, name: file.name, type: kindOf(file.mimeType), mimeType: file.mimeType,
  ...(file.modifiedTime === undefined ? {} : { modified: file.modifiedTime }),
  ...(file.size === undefined ? {} : { size: Number(file.size) }),
  ...(file.parents === undefined ? {} : { parents: file.parents }),
  ...(file.webViewLink === undefined ? {} : { link: file.webViewLink }),
  ...(file.owners?.[0]?.emailAddress === undefined ? {} : { owner: file.owners[0].emailAddress }),
})

function kindOf(mimeType: string): string {
  return mimeType === DOC ? 'Google Doc' : mimeType === SHEET ? 'Google Sheet' : mimeType === FOLDER ? 'folder' : mimeType.startsWith('application/vnd.google-apps.') ? mimeType.slice(28) : 'file'
}

/** Export formats of Docs and Sheets, with the file extension each gets. */
const EXPORTS: Record<string, { readonly mimeType: string; readonly extension: string; readonly from: readonly string[] }> = {
  text: { mimeType: 'text/plain', extension: 'txt', from: [DOC] },
  markdown: { mimeType: 'text/markdown', extension: 'md', from: [DOC] },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx', from: [DOC] },
  csv: { mimeType: 'text/csv', extension: 'csv', from: [SHEET] },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', from: [SHEET] },
  pdf: { mimeType: 'application/pdf', extension: 'pdf', from: [DOC, SHEET] },
}

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
/** Drive's query strings are single-quoted: escape quotes and backslashes in values. */
const quoted = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const MIME_BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json', docx: EXPORTS['docx']!.mimeType, xlsx: EXPORTS['xlsx']!.mimeType, zip: 'application/zip' }
const mimeOf = (path: string) => MIME_BY_EXTENSION[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream'

/** A multipart/related upload body: the metadata JSON, then the bytes. */
function multipart(metadata: Record<string, unknown>, bytes: Uint8Array, contentType: string): { data: Uint8Array; contentType: string } {
  const boundary = `mr-robot-${crypto.randomUUID()}`
  const encoder = new TextEncoder()
  const head = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`)
  const tail = encoder.encode(`\r\n--${boundary}--`)
  const data = new Uint8Array(head.length + bytes.length + tail.length)
  data.set(head, 0)
  data.set(bytes, head.length)
  data.set(tail, head.length + bytes.length)
  return { data, contentType: `multipart/related; boundary=${boundary}` }
}

export function driveTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const getFile = (use: Parameters<typeof google>[1], id: string) => google(host, use, { method: 'GET', url: `${DRIVE}/files/${encodeURIComponent(id)}${query({ fields: FIELDS, supportsAllDrives: true })}` }, File)
  const readWorkspace = (path: string) => Effect.tryPromise({ try: () => host.readFile(path), catch: (error) => new ConnectorRefused({ message: `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}` }) })
  const save = (path: string, bytes: Uint8Array) => Effect.promise(() => host.saveFile(path, bytes))
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'drive_search',
      service: 'drive',
      description: 'Find files: plain words search names and content; or a Drive query (e.g. "mimeType = \'application/vnd.google-apps.spreadsheet\' and modifiedTime > \'2026-10-01\'"). folderId lists one folder. Newest first.',
      parameters: { properties: { query: { type: 'string' }, folderId: { type: 'string' }, max: { type: 'number' } } },
      action: (args) => `search "${str(args, 'query')}"${str(args, 'folderId') === '' ? '' : ` in ${str(args, 'folderId')}`}`,
      run: (args, use) => {
        const words = str(args, 'query').trim()
        const raw = /\b(=|contains|in parents|mimeType|modifiedTime|trashed)\b/.test(words)
        const clauses = [
          ...(words === '' ? [] : [raw ? words : `fullText contains ${quoted(words)}`]),
          ...(str(args, 'folderId') === '' ? [] : [`${quoted(str(args, 'folderId'))} in parents`]),
          'trashed = false',
        ]
        return Effect.map(
          google(host, use, { method: 'GET', url: `${DRIVE}/files${query({ q: clauses.join(' and '), pageSize: Math.min(Number(args['max'] ?? 25) || 25, 100), orderBy: words === '' || raw ? 'modifiedTime desc' : undefined, fields: `files(${FIELDS}),nextPageToken`, supportsAllDrives: true, includeItemsFromAllDrives: true })}` }, Files),
          (body) => body.files.map(shown),
        )
      },
    },
    {
      name: 'drive_download',
      service: 'drive',
      description: 'Download a file into your Workspace under drive/. Google Docs come as text and Sheets as CSV (use drive_export for other formats).',
      parameters: { properties: { fileId: { type: 'string' } }, required: ['fileId'] },
      action: (args) => `download ${str(args, 'fileId')}`,
      run: (args, use) => Effect.gen(function* () {
        const file = yield* getFile(use, str(args, 'fileId'))
        const format = file.mimeType === DOC ? EXPORTS['text']! : file.mimeType === SHEET ? EXPORTS['csv']! : undefined
        if (format === undefined && file.mimeType.startsWith('application/vnd.google-apps.')) return yield* new ConnectorRefused({ message: `a ${kindOf(file.mimeType)} cannot be downloaded; use drive_export` })
        const content = yield* googleBytes(host, use, format === undefined ? `${DRIVE}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true` : `${DRIVE}/files/${encodeURIComponent(file.id)}/export${query({ mimeType: format.mimeType })}`)
        const name = format === undefined ? safeName(file.name) : `${safeName(file.name)}.${format.extension}`
        const path = `drive/${name}`
        yield* save(path, content.bytes)
        return { path, size: content.bytes.length, from: shown(file) }
      }),
    },
    {
      name: 'drive_export',
      service: 'drive',
      description: 'Export a Google Doc (text, markdown, docx, pdf) or Sheet (csv of its first sheet, xlsx, pdf) into your Workspace under drive/.',
      parameters: { properties: { fileId: { type: 'string' }, format: { type: 'string', enum: Object.keys(EXPORTS) } }, required: ['fileId', 'format'] },
      action: (args) => `export ${str(args, 'fileId')} as ${str(args, 'format')}`,
      run: (args, use) => Effect.gen(function* () {
        const file = yield* getFile(use, str(args, 'fileId'))
        const format = EXPORTS[str(args, 'format')]
        if (format === undefined || !format.from.includes(file.mimeType)) return yield* new ConnectorRefused({ message: `a ${kindOf(file.mimeType)} cannot be exported as ${str(args, 'format')}` })
        const content = yield* googleBytes(host, use, `${DRIVE}/files/${encodeURIComponent(file.id)}/export${query({ mimeType: format.mimeType })}`)
        const path = `drive/${safeName(file.name)}.${format.extension}`
        yield* save(path, content.bytes)
        return { path, size: content.bytes.length }
      }),
    },
    {
      name: 'drive_upload',
      service: 'drive',
      description: 'Upload a Workspace file to Drive, optionally into a folder and under another name; convert: true turns CSV/XLSX into a Google Sheet and text/DOCX/HTML into a Google Doc.',
      parameters: { properties: { path: { type: 'string' }, folderId: { type: 'string' }, name: { type: 'string' }, convert: { type: 'boolean' } }, required: ['path'] },
      action: (args) => `upload ${str(args, 'path')}`,
      run: (args, use) => Effect.gen(function* () {
        const path = str(args, 'path')
        const bytes = yield* readWorkspace(path)
        const contentType = mimeOf(path)
        const target = args['convert'] === true ? (/csv|spreadsheet/.test(contentType) ? SHEET : DOC) : undefined
        const name = str(args, 'name') || (target === undefined ? path.split('/').at(-1)! : path.split('/').at(-1)!.replace(/\.[^.]+$/, ''))
        const body = multipart({ name, ...(str(args, 'folderId') === '' ? {} : { parents: [str(args, 'folderId')] }), ...(target === undefined ? {} : { mimeType: target }) }, bytes, contentType)
        return shown(yield* google(host, use, { method: 'POST', url: `${UPLOAD}/files${query({ uploadType: 'multipart', fields: FIELDS, supportsAllDrives: true })}`, bytes: body }, File))
      }),
    },
    {
      name: 'drive_import',
      service: 'drive',
      description: 'Replace the content of an existing Google Doc or Sheet with a Workspace file (text/markdown/docx into a Doc, CSV into the first sheet of a Sheet); the file keeps its id, link and sharing.',
      parameters: { properties: { fileId: { type: 'string' }, path: { type: 'string' } }, required: ['fileId', 'path'] },
      action: (args) => `import ${str(args, 'path')} into ${str(args, 'fileId')}`,
      run: (args, use) => Effect.gen(function* () {
        const file = yield* getFile(use, str(args, 'fileId'))
        if (file.mimeType !== DOC && file.mimeType !== SHEET) return yield* new ConnectorRefused({ message: 'drive_import replaces Google Docs and Sheets; use drive_upload for other files' })
        const bytes = yield* readWorkspace(str(args, 'path'))
        return shown(yield* google(host, use, { method: 'PATCH', url: `${UPLOAD}/files/${encodeURIComponent(file.id)}${query({ uploadType: 'media', fields: FIELDS, supportsAllDrives: true })}`, bytes: { data: bytes, contentType: mimeOf(str(args, 'path')) } }, File))
      }),
    },
    {
      name: 'drive_create_folder',
      service: 'drive',
      description: 'Create a folder, optionally inside another.',
      parameters: { properties: { name: { type: 'string' }, parentId: { type: 'string' } }, required: ['name'] },
      action: (args) => `create folder "${str(args, 'name')}"`,
      run: (args, use) => Effect.map(google(host, use, { method: 'POST', url: `${DRIVE}/files${query({ fields: FIELDS, supportsAllDrives: true })}`, json: { name: str(args, 'name'), mimeType: FOLDER, ...(str(args, 'parentId') === '' ? {} : { parents: [str(args, 'parentId')] }) } }, File), shown),
    },
    {
      name: 'drive_move',
      service: 'drive',
      description: 'Move a file into a folder (out of its current folders); a new name renames it too.',
      parameters: { properties: { fileId: { type: 'string' }, folderId: { type: 'string' }, name: { type: 'string' } }, required: ['fileId', 'folderId'] },
      action: (args) => `move ${str(args, 'fileId')} to ${str(args, 'folderId')}`,
      run: (args, use) => Effect.gen(function* () {
        const file = yield* getFile(use, str(args, 'fileId'))
        return shown(yield* google(host, use, { method: 'PATCH', url: `${DRIVE}/files/${encodeURIComponent(file.id)}${query({ addParents: str(args, 'folderId'), removeParents: (file.parents ?? []).join(',') || undefined, fields: FIELDS, supportsAllDrives: true })}`, json: str(args, 'name') === '' ? {} : { name: str(args, 'name') } }, File))
      }),
    },
    {
      name: 'drive_share',
      service: 'drive',
      description: 'Share a file or folder with a person as reader, commenter or writer; Google e-mails them unless notify is false.',
      parameters: { properties: { fileId: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['reader', 'commenter', 'writer'] }, notify: { type: 'boolean' }, message: { type: 'string' } }, required: ['fileId', 'email', 'role'] },
      action: (args) => `share ${str(args, 'fileId')} with ${str(args, 'email')} as ${str(args, 'role')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'POST', url: `${DRIVE}/files/${encodeURIComponent(str(args, 'fileId'))}/permissions${query({ sendNotificationEmail: args['notify'] !== false, emailMessage: str(args, 'message') || undefined, supportsAllDrives: true })}`, json: { type: 'user', role: str(args, 'role'), emailAddress: str(args, 'email') } }, Permission),
        (permission) => ({ shared: true, permissionId: permission.id, role: permission.role }),
      ),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}
