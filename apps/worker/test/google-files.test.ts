import { beforeEach, describe, expect, it } from 'vitest'
import { GooglePlugin } from '../src/connectors/google/plugin.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { account, runTool, testHost } from './connector-host.ts'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const DOCS = 'https://docs.googleapis.com/v1/documents'
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const PEOPLE = 'https://people.googleapis.com/v1'
const ANNA = account('google', 'Private', 'anna@gmail.test', ['drive', 'contacts'])

beforeEach(() => connectorFixtures.reset())

const setup = () => {
  const test = testHost('google', [ANNA])
  return { ...test, tools: GooglePlugin.tools(test.host) }
}
const json = (call: RecordedCall) => JSON.parse(call.body ?? 'null') as Record<string, unknown>
const last = () => connectorFixtures.calls.at(-1)!
const bodyOf = (text: string) => JSON.parse(text.split('\n').slice(1).join('\n'))

const sheet = { id: 'f-sheet', name: 'Budget 2026', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-10-07T10:00:00Z', parents: ['folder-home'], webViewLink: 'https://docs.google.com/spreadsheets/d/f-sheet' }
const doc = { id: 'f-doc', name: 'Lease', mimeType: 'application/vnd.google-apps.document', parents: ['folder-home'] }
const pdf = { id: 'f-pdf', name: 'scan.pdf', mimeType: 'application/pdf', size: '9', parents: ['folder-home'] }

describe('Drive tools against recorded responses (cn-9mzm)', () => {
  it('drive_search turns words into a full-text query and keeps a Drive query as it is', async () => {
    connectorFixtures.on('GET', `${DRIVE}/files?`, { files: [sheet] })
    const { tools } = setup()
    const found = bodyOf(await runTool(tools, 'drive_search', { query: "Anna's budget", folderId: 'folder-home' }))
    expect(new URL(last().url).searchParams.get('q')).toBe("fullText contains 'Anna\\'s budget' and 'folder-home' in parents and trashed = false")
    expect(found).toEqual([expect.objectContaining({ id: 'f-sheet', type: 'Google Sheet', link: 'https://docs.google.com/spreadsheets/d/f-sheet' })])
    await runTool(tools, 'drive_search', { query: "mimeType = 'application/pdf'" })
    expect(new URL(last().url).searchParams.get('q')).toBe("mimeType = 'application/pdf' and trashed = false")
    expect(new URL(last().url).searchParams.get('orderBy')).toBe('modifiedTime desc')
  })

  it('downloads files as they are and Docs/Sheets as text/CSV; exports other formats', async () => {
    connectorFixtures.on('GET', `${DRIVE}/files/f-pdf?`, pdf)
    connectorFixtures.on('GET', `${DRIVE}/files/f-pdf?alt=media`, new Response('%PDF scan', { headers: { 'content-type': 'application/pdf' } }))
    connectorFixtures.on('GET', `${DRIVE}/files/f-sheet?`, sheet)
    connectorFixtures.on('GET', `${DRIVE}/files/f-sheet/export?`, (call: RecordedCall) => new Response(new URL(call.url).searchParams.get('mimeType') === 'text/csv' ? 'Month,Amount\nOct,100' : 'XLSX', { headers: { 'content-type': 'text/csv' } }))
    const { tools, files } = setup()
    expect(bodyOf(await runTool(tools, 'drive_download', { fileId: 'f-pdf' })).path).toBe('drive/scan.pdf')
    expect(new TextDecoder().decode(files.get('drive/scan.pdf'))).toBe('%PDF scan')
    expect(bodyOf(await runTool(tools, 'drive_download', { fileId: 'f-sheet' })).path).toBe('drive/Budget 2026.csv')
    expect(new TextDecoder().decode(files.get('drive/Budget 2026.csv'))).toBe('Month,Amount\nOct,100')
    expect(bodyOf(await runTool(tools, 'drive_export', { fileId: 'f-sheet', format: 'xlsx' })).path).toBe('drive/Budget 2026.xlsx')
    expect(new URL(last().url).searchParams.get('mimeType')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(await runTool(tools, 'drive_export', { fileId: 'f-sheet', format: 'docx' })).toContain('Failed: a Google Sheet cannot be exported as docx')
  })

  it('uploads a Workspace file as multipart, converting a CSV into a Sheet', async () => {
    connectorFixtures.on('POST', `${UPLOAD}/files?`, { id: 'f-new', name: 'expenses', mimeType: 'application/vnd.google-apps.spreadsheet' })
    const { tools, host } = setup()
    await host.saveFile('out/expenses.csv', new TextEncoder().encode('a,b\n1,2'))
    const uploaded = bodyOf(await runTool(tools, 'drive_upload', { path: 'out/expenses.csv', folderId: 'folder-home', convert: true }))
    expect(uploaded).toMatchObject({ id: 'f-new', type: 'Google Sheet' })
    const call = last()
    expect(new URL(call.url).searchParams.get('uploadType')).toBe('multipart')
    expect(call.headers['content-type']).toMatch(/^multipart\/related; boundary=/)
    expect(call.body).toContain('{"name":"expenses","parents":["folder-home"],"mimeType":"application/vnd.google-apps.spreadsheet"}')
    expect(call.body).toContain('Content-Type: text/csv\r\n\r\na,b\n1,2')
  })

  it('imports a file into an existing Doc, creates folders, moves out of the old folder, and shares', async () => {
    connectorFixtures.on('GET', `${DRIVE}/files/f-doc?`, doc)
    connectorFixtures.on('PATCH', `${UPLOAD}/files/f-doc?`, doc)
    connectorFixtures.on('POST', `${DRIVE}/files?`, { id: 'folder-new', name: 'Invoices', mimeType: 'application/vnd.google-apps.folder' })
    connectorFixtures.on('PATCH', `${DRIVE}/files/f-doc?`, { ...doc, parents: ['folder-new'] })
    connectorFixtures.on('POST', `${DRIVE}/files/f-doc/permissions`, { id: 'perm-1', role: 'writer' })
    const { tools, host } = setup()
    await host.saveFile('lease.md', new TextEncoder().encode('# Lease\nUpdated.'))
    await runTool(tools, 'drive_import', { fileId: 'f-doc', path: 'lease.md' })
    expect(new URL(last().url).searchParams.get('uploadType')).toBe('media')
    expect(last().body).toBe('# Lease\nUpdated.')
    expect(bodyOf(await runTool(tools, 'drive_create_folder', { name: 'Invoices' }))).toMatchObject({ id: 'folder-new', type: 'folder' })
    expect(json(last())).toEqual({ name: 'Invoices', mimeType: 'application/vnd.google-apps.folder' })
    await runTool(tools, 'drive_move', { fileId: 'f-doc', folderId: 'folder-new' })
    expect(Object.fromEntries(new URL(last().url).searchParams)).toMatchObject({ addParents: 'folder-new', removeParents: 'folder-home' })
    expect(await runTool(tools, 'drive_share', { fileId: 'f-doc', email: 'ben@home.test', role: 'writer', notify: false })).toContain('"permissionId": "perm-1"')
    expect(json(last())).toEqual({ type: 'user', role: 'writer', emailAddress: 'ben@home.test' })
    expect(new URL(last().url).searchParams.get('sendNotificationEmail')).toBe('false')
  })
})

describe('Docs and Sheets in place (cn-pcf6)', () => {
  it('reads a Doc with headings and tables, replaces text and appends', async () => {
    connectorFixtures.on('GET', `${DOCS}/f-doc`, {
      documentId: 'f-doc', title: 'Lease',
      body: { content: [
        { paragraph: { paragraphStyle: { namedStyleType: 'HEADING_1' }, elements: [{ textRun: { content: 'Lease\n' } }] } },
        { paragraph: { elements: [{ textRun: { content: 'Rent is ' } }, { textRun: { content: '2500 PLN.\n' } }] } },
        { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'Due\n' } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: '10th\n' } }] } }] }] }] } },
      ] },
    })
    connectorFixtures.on('POST', `${DOCS}/f-doc:batchUpdate`, (call: RecordedCall) => ('replaceAllText' in ((json(call)['requests'] as Array<Record<string, unknown>>)[0] ?? {}) ? { replies: [{ replaceAllText: { occurrencesChanged: 1 } }] } : { replies: [{}] }))
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'docs_read', { documentId: 'f-doc' }))).toEqual({ title: 'Lease', text: '# Lease\nRent is 2500 PLN.\nDue\t10th' })
    expect(await runTool(tools, 'docs_replace', { documentId: 'f-doc', find: '2500 PLN', replace: '2700 PLN' })).toContain('"replaced": 1')
    expect(json(last())).toEqual({ requests: [{ replaceAllText: { containsText: { text: '2500 PLN', matchCase: true }, replaceText: '2700 PLN' } }] })
    await runTool(tools, 'docs_append', { documentId: 'f-doc', text: '\nSigned.' })
    expect(json(last())).toEqual({ requests: [{ insertText: { endOfSegmentLocation: {}, text: '\nSigned.' } }] })
  })

  it('lists sheets, reads cells, writes a cell in place and appends rows', async () => {
    connectorFixtures.on('GET', `${SHEETS}/f-sheet?`, { spreadsheetId: 'f-sheet', properties: { title: 'Budget 2026' }, sheets: [{ properties: { sheetId: 0, title: 'Expenses', gridProperties: { rowCount: 1000, columnCount: 26 } } }] })
    connectorFixtures.on('GET', `${SHEETS}/f-sheet/values/`, { range: 'Expenses!A1:B2', majorDimension: 'ROWS', values: [['Month', 'Amount'], ['Oct', '100']] })
    connectorFixtures.on('PUT', `${SHEETS}/f-sheet/values/`, { spreadsheetId: 'f-sheet', updatedRange: 'Expenses!B2', updatedRows: 1, updatedColumns: 1, updatedCells: 1 })
    connectorFixtures.on('POST', `${SHEETS}/f-sheet/values/`, { spreadsheetId: 'f-sheet', updates: { updatedRange: 'Expenses!A3:B3', updatedCells: 2 } })
    const { tools } = setup()
    expect(bodyOf(await runTool(tools, 'sheets_info', { spreadsheetId: 'f-sheet' }))).toEqual({ title: 'Budget 2026', sheets: [{ title: 'Expenses', rows: 1000, columns: 26 }] })
    expect(bodyOf(await runTool(tools, 'sheets_read', { spreadsheetId: 'f-sheet', range: 'Expenses!A1:B2' })).values).toEqual([['Month', 'Amount'], ['Oct', '100']])
    expect(decodeURIComponent(last().url)).toBe(`${SHEETS}/f-sheet/values/Expenses!A1:B2`)
    expect(await runTool(tools, 'sheets_write', { spreadsheetId: 'f-sheet', range: 'Expenses!B2', values: [['=100*1.23']] })).toContain('"updatedCells": 1')
    expect(new URL(last().url).searchParams.get('valueInputOption')).toBe('USER_ENTERED')
    expect(json(last())).toEqual({ range: 'Expenses!B2', majorDimension: 'ROWS', values: [['=100*1.23']] })
    await runTool(tools, 'sheets_append', { spreadsheetId: 'f-sheet', range: 'Expenses!A:B', values: [['Nov', 120]] })
    expect(decodeURIComponent(new URL(last().url).pathname)).toBe('/v4/spreadsheets/f-sheet/values/Expenses!A:B:append')
    expect(new URL(last().url).searchParams.get('insertDataOption')).toBe('INSERT_ROWS')
  })
})

describe('Contacts (cn-0c23)', () => {
  it('warms the search cache, then finds a person with addresses and phones', async () => {
    connectorFixtures.on('GET', `${PEOPLE}/people:searchContacts`, (call: RecordedCall) => (new URL(call.url).searchParams.get('query') === ''
      ? {}
      : { results: [{ person: { resourceName: 'people/c1', names: [{ displayName: 'Jan Kowalski' }], emailAddresses: [{ value: 'jan@firm.test', type: 'work' }], phoneNumbers: [{ value: '+48 600 100 200', type: 'mobile' }], addresses: [{ formattedValue: 'ul. Prosta 1, Warszawa' }], organizations: [{ name: 'Firm', title: 'Accountant' }] } }] }))
    connectorFixtures.on('GET', `${PEOPLE}/people/c1?`, { resourceName: 'people/c1', names: [{ displayName: 'Jan Kowalski' }], birthdays: [{ date: { month: 5, day: 3 } }] })
    const { tools } = setup()
    const found = bodyOf(await runTool(tools, 'contacts_search', { query: 'Kowalski' }))
    expect(connectorFixtures.calls.map((call) => new URL(call.url).searchParams.get('query'))).toEqual(['', 'Kowalski'])
    expect(found).toEqual([{ id: 'people/c1', name: 'Jan Kowalski', emails: ['jan@firm.test (work)'], phones: ['+48 600 100 200 (mobile)'], addresses: ['ul. Prosta 1, Warszawa'], organization: 'Firm, Accountant' }])
    expect(bodyOf(await runTool(tools, 'contacts_get', { id: 'people/c1' }))).toMatchObject({ name: 'Jan Kowalski', birthday: '5-3' })
  })
})
