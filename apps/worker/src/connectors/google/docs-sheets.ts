/**
 * Docs and Sheets in place (v1.5 ticket 04, cn-pcf6): read a document's text, replace text, append
 * text; read, write and append sheet cells, list a spreadsheet's sheets. No re-upload.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { ConnectorHost, ConnectorToolSpec } from '../connector.ts'
import { google, query } from './api.ts'

const DOCS = 'https://docs.googleapis.com/v1/documents'
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'

const TextRun = Schema.Struct({ textRun: Schema.optional(Schema.Struct({ content: Schema.optional(Schema.String) })) })
const Paragraph = Schema.Struct({ elements: Schema.optional(Schema.Array(TextRun)), paragraphStyle: Schema.optional(Schema.Struct({ namedStyleType: Schema.optional(Schema.String) })) })
const Cell = Schema.Struct({ content: Schema.optional(Schema.Array(Schema.Struct({ paragraph: Schema.optional(Paragraph) }))) })
const StructuralElement = Schema.Struct({
  paragraph: Schema.optional(Paragraph),
  table: Schema.optional(Schema.Struct({ tableRows: Schema.optional(Schema.Array(Schema.Struct({ tableCells: Schema.optional(Schema.Array(Cell)) }))) })),
})
const Document = Schema.Struct({ documentId: Schema.String, title: Schema.optional(Schema.String), body: Schema.optional(Schema.Struct({ content: Schema.optional(Schema.Array(StructuralElement)) })) })
const BatchReply = Schema.Struct({ replies: Schema.optional(Schema.Array(Schema.Struct({ replaceAllText: Schema.optional(Schema.Struct({ occurrencesChanged: Schema.optional(Schema.Number) })) }))) })
const Values = Schema.Struct({ range: Schema.optional(Schema.String), values: Schema.optional(Schema.Array(Schema.Array(Schema.Unknown))) })
const Updated = Schema.Struct({ updatedRange: Schema.optional(Schema.String), updatedCells: Schema.optional(Schema.Number), updates: Schema.optional(Schema.Struct({ updatedRange: Schema.optional(Schema.String), updatedCells: Schema.optional(Schema.Number) })) })
const Spreadsheet = Schema.Struct({ spreadsheetId: Schema.String, properties: Schema.optional(Schema.Struct({ title: Schema.optional(Schema.String) })), sheets: Schema.optional(Schema.Array(Schema.Struct({ properties: Schema.Struct({ sheetId: Schema.optional(Schema.Number), title: Schema.String, gridProperties: Schema.optional(Schema.Struct({ rowCount: Schema.optional(Schema.Number), columnCount: Schema.optional(Schema.Number) })) }) }))) })

const HEADINGS: Record<string, string> = { TITLE: '# ', HEADING_1: '# ', HEADING_2: '## ', HEADING_3: '### ', HEADING_4: '#### ' }

/** A document as text: headings marked, tables as tab-separated rows. */
export function documentText(document: typeof Document.Type): string {
  const paragraph = (value: typeof Paragraph.Type | undefined): string => {
    const text = (value?.elements ?? []).map((element) => element.textRun?.content ?? '').join('')
    const prefix = HEADINGS[value?.paragraphStyle?.namedStyleType ?? ''] ?? ''
    return text.trim() === '' ? text : prefix + text
  }
  return (document.body?.content ?? []).map((element) => {
    if (element.paragraph !== undefined) return paragraph(element.paragraph)
    if (element.table !== undefined) return (element.table.tableRows ?? []).map((row) => (row.tableCells ?? []).map((cell) => (cell.content ?? []).map((part) => paragraph(part.paragraph).trim()).join(' ')).join('\t')).join('\n') + '\n'
    return ''
  }).join('').trim()
}

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
const rows = (value: unknown): unknown[][] => (Array.isArray(value) ? value.map((row) => (Array.isArray(row) ? row : [row])) : [])
const sheetUrl = (args: Args, suffix: string) => `${SHEETS}/${encodeURIComponent(str(args, 'spreadsheetId'))}${suffix}`

export function docsSheetsTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'docs_read',
      service: 'drive',
      description: 'Read a Google Doc as text (headings marked with #, tables as tab-separated rows).',
      parameters: { properties: { documentId: { type: 'string' } }, required: ['documentId'] },
      action: (args) => `read doc ${str(args, 'documentId')}`,
      run: (args, use) => Effect.map(google(host, use, { method: 'GET', url: `${DOCS}/${encodeURIComponent(str(args, 'documentId'))}` }, Document), (document) => ({ title: document.title ?? '', text: documentText(document) })),
    },
    {
      name: 'docs_replace',
      service: 'drive',
      description: 'Replace every occurrence of a text in a Google Doc, in place (formatting around it stays).',
      parameters: { properties: { documentId: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, matchCase: { type: 'boolean' } }, required: ['documentId', 'find', 'replace'] },
      action: (args) => `replace "${str(args, 'find')}" in doc ${str(args, 'documentId')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'POST', url: `${DOCS}/${encodeURIComponent(str(args, 'documentId'))}:batchUpdate`, json: { requests: [{ replaceAllText: { containsText: { text: str(args, 'find'), matchCase: args['matchCase'] !== false }, replaceText: str(args, 'replace') } }] } }, BatchReply),
        (reply) => ({ replaced: reply.replies?.[0]?.replaceAllText?.occurrencesChanged ?? 0 }),
      ),
    },
    {
      name: 'docs_append',
      service: 'drive',
      description: 'Append text at the end of a Google Doc.',
      parameters: { properties: { documentId: { type: 'string' }, text: { type: 'string' } }, required: ['documentId', 'text'] },
      action: (args) => `append to doc ${str(args, 'documentId')}`,
      run: (args, use) => Effect.as(
        google(host, use, { method: 'POST', url: `${DOCS}/${encodeURIComponent(str(args, 'documentId'))}:batchUpdate`, json: { requests: [{ insertText: { endOfSegmentLocation: {}, text: str(args, 'text') } }] } }, BatchReply),
        { appended: true },
      ),
    },
    {
      name: 'sheets_info',
      service: 'drive',
      description: 'A spreadsheet\'s title and its sheets with their sizes.',
      parameters: { properties: { spreadsheetId: { type: 'string' } }, required: ['spreadsheetId'] },
      action: (args) => `sheets of ${str(args, 'spreadsheetId')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'GET', url: sheetUrl(args, query({ fields: 'spreadsheetId,properties.title,sheets.properties' })) }, Spreadsheet),
        (sheet) => ({ title: sheet.properties?.title ?? '', sheets: (sheet.sheets ?? []).map((entry) => ({ title: entry.properties.title, rows: entry.properties.gridProperties?.rowCount ?? null, columns: entry.properties.gridProperties?.columnCount ?? null })) }),
      ),
    },
    {
      name: 'sheets_read',
      service: 'drive',
      description: 'Read cells in A1 notation (e.g. "Budget!A1:F40"); values as shown in the sheet.',
      parameters: { properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' } }, required: ['spreadsheetId', 'range'] },
      action: (args) => `read ${str(args, 'range')}`,
      run: (args, use) => Effect.map(google(host, use, { method: 'GET', url: sheetUrl(args, `/values/${encodeURIComponent(str(args, 'range'))}`) }, Values), (body) => ({ range: body.range ?? str(args, 'range'), values: body.values ?? [] })),
    },
    {
      name: 'sheets_write',
      service: 'drive',
      description: 'Write cells in place starting at a range (rows of values; formulas like =SUM(B2:B9) work, as typed by a person).',
      parameters: { properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array', items: {} } } }, required: ['spreadsheetId', 'range', 'values'] },
      action: (args) => `write ${str(args, 'range')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'PUT', url: sheetUrl(args, `/values/${encodeURIComponent(str(args, 'range'))}${query({ valueInputOption: 'USER_ENTERED' })}`), json: { range: str(args, 'range'), majorDimension: 'ROWS', values: rows(args['values']) } }, Updated),
        (body) => ({ updatedRange: body.updatedRange ?? null, updatedCells: body.updatedCells ?? 0 }),
      ),
    },
    {
      name: 'sheets_append',
      service: 'drive',
      description: 'Append rows after the last row of a table (range names the sheet or table, e.g. "Expenses!A:D").',
      parameters: { properties: { spreadsheetId: { type: 'string' }, range: { type: 'string' }, values: { type: 'array', items: { type: 'array', items: {} } } }, required: ['spreadsheetId', 'range', 'values'] },
      action: (args) => `append ${rows(args['values']).length} rows to ${str(args, 'range')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'POST', url: sheetUrl(args, `/values/${encodeURIComponent(str(args, 'range'))}:append${query({ valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' })}`), json: { majorDimension: 'ROWS', values: rows(args['values']) } }, Updated),
        (body) => ({ updatedRange: body.updates?.updatedRange ?? null, updatedCells: body.updates?.updatedCells ?? 0 }),
      ),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}
