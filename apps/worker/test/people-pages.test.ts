/**
 * People pages (v1.20 ticket 04, dm-wtn9, dm-s0gy, dm-p7l1, dm-ii3r, dm-pygh): memory/people/<name>.md at the owner's scope, written by
 * every Robot of the owner with its name in the history, INDEX.md kept by the platform, found by memory_search, not another Member's.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileHistoryView, WorkspaceFileView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

/** Every v1.20 test runs in code mode first, then with direct tool calls (v1.20.1). */
const MODES = [['code mode', true], ['direct calls', false]] as const
let codeMode = true

afterEach(() => {
  programmed.on = false
})

beforeEach(async () => {
  programmed.on = true
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function staff(as: string, name: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, identity: { name, title: '', description: `${name} does things`, avatarColor: '#8b5cf6' }, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(as: string, id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(as, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const call = (name: string, args: Record<string, unknown>) => ({ name, args: { on: 'files', ...args } })
const lastResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
/** The tool results of the last Turn (since its message), joined: one per call directly, one per program in code mode. */
const turnResults = (id: string, message: string) => {
  const request = requests.get(id)!.at(-1)!
  const from = request.messages.findLastIndex((entry) => entry.role === 'user' && JSON.stringify(entry).includes(message))
  return request.messages.slice(from).filter((entry) => entry.role === 'tool').map((entry) => entry.content.map((block) => ('text' in block ? block.text : '')).join('')).join('\n')
}
const PAGE = '# Jan Kowalski\n\nRole: customer\nHow we know them: he wrote about the flat.\n\n## Facts\n- 2026-10-20 Wants a flat with a garage.\n'

describe.each(MODES)('people pages (dm-wtn9, dm-s0gy, dm-p7l1, dm-ii3r), %s', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it('two Robots of one owner write one page, named in its history; INDEX.md follows; search finds it; Files shows it', async () => {
    const seller = await staff(ANNA, 'Seller')
    const bookkeeper = await staff(ANNA, 'Bookkeeper')
    await turn(ANNA, seller, 'Jan wrote', [{ calls: [call('read', { file_path: 'memory/people/_template.md' }), call('write', { file_path: 'memory/people/jan-kowalski.md', content: PAGE })] }, { say: 'Noted Jan.' }])
    expect(turnResults(seller, 'Jan wrote')).toContain('How we know them')
    await turn(ANNA, bookkeeper, 'Jan paid', [{ calls: [call('edit', { file_path: 'memory/people/jan-kowalski.md', old_string: '- 2026-10-20 Wants a flat with a garage.', new_string: '- 2026-10-20 Wants a flat with a garage.\n- 2026-10-21 Paid the deposit.' })] }, { say: 'Noted the deposit.' }])

    const history = (await api<FileHistoryView>(ANNA, `/api/robots/${seller}/file/history?path=memory/people/jan-kowalski.md`)).body
    expect(history.current?.by).toBe('Bookkeeper')
    expect(history.versions.map((version) => version.by)).toEqual(['Seller'])

    await turn(ANNA, seller, 'who is there?', [{ calls: [call('read', { file_path: 'memory/people/INDEX.md' }), call('glob', { pattern: 'memory/people/*' })] }, { say: 'Jan.' }])
    const listing = turnResults(seller, 'who is there?')
    expect(listing).toMatch(/- \[Jan Kowalski\]\(jan-kowalski\.md\) — customer \(last touched \d{4}-\d{2}-\d{2}\)/)
    expect(listing).toContain('memory/people/jan-kowalski.md')
    // INDEX.md and the template are the platform's; a page is not deleted by a Robot.
    await turn(ANNA, seller, 'try', [{ calls: [call('write', { file_path: 'memory/people/INDEX.md', content: 'x' }), call('delete_file', { path: 'memory/people/jan-kowalski.md' })] }, { say: 'No.' }])
    expect(turnResults(seller, 'try')).toContain('kept by the platform')
    expect(turnResults(seller, 'try')).toContain('only your owner deletes it')

    await turn(ANNA, seller, 'deposit?', [{ calls: [{ name: 'memory_search', args: { query: 'deposit' } }] }, { say: 'Paid.' }])
    const found = JSON.parse(lastResults(seller).findLast((text) => text.includes('"matches"'))!) as { matches: unknown[] } | Array<{ matches: unknown[] }>
    expect((Array.isArray(found) ? found[0]! : found).matches[0]).toMatchObject({ path: 'memory/people/jan-kowalski.md', scope: 'member' })

    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${seller}/files`)).body
    expect(files.filter((file) => file.group === 'member').map((file) => file.path).sort()).toEqual(['memory/people/INDEX.md', 'memory/people/jan-kowalski.md'])
    // The owner corrects a page from the Files view; his name is in the history.
    await api(ANNA, `/api/robots/${seller}/file?path=memory/people/jan-kowalski.md`, { method: 'PUT', body: { content: PAGE.replace('customer', 'buyer') } })
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${bookkeeper}/file/history?path=memory/people/jan-kowalski.md`)).body.current?.by).toBe('Anna')

    // Another Member's Robot has its own owner's pages, not Anna's.
    const bens = await staff(BEN, 'Helper')
    await turn(BEN, bens, 'Jan?', [{ calls: [call('read', { file_path: 'memory/people/jan-kowalski.md' })] }, { say: 'No Jan.' }])
    expect(turnResults(bens, 'Jan?')).toContain('does not exist')
  }, 60_000)

  it('the owner deletes and restores a page; two Robots writing two pages at once both land in INDEX.md (v1.20.1)', async () => {
    const seller = await staff(ANNA, 'Seller')
    const buyer = await staff(ANNA, 'Buyer')
    const page = (name: string) => ({ calls: [call('write', { on: 'files', file_path: `memory/people/${name}.md`, content: `# ${name}\n\nRole: customer\n\n## Facts\n- 2026-10-21 Met.\n` })] })
    scripts.set(seller, [page('jan-kowalski'), { say: 'Noted.' }])
    scripts.set(buyer, [page('ewa-nowak'), { say: 'Noted.' }])
    await Promise.all([api(ANNA, `/api/robots/${seller}/messages`, { body: { text: 'Jan' } }), api(ANNA, `/api/robots/${buyer}/messages`, { body: { text: 'Ewa' } })])
    await Promise.all([settle(seller), settle(buyer)])
    const index = () => api<{ text?: string }>(ANNA, `/api/robots/${seller}/file?path=memory/people/INDEX.md`).then((answer) => answer.body.text ?? '')
    expect(await index()).toContain('jan-kowalski.md')
    expect(await index()).toContain('ewa-nowak.md')
    // The owner deletes Jan's page: gone from the Files and INDEX.md, its last version kept.
    expect((await api(ANNA, `/api/robots/${seller}/file?path=memory/people/jan-kowalski.md`, { method: 'DELETE' })).status).toBe(200)
    expect((await api(ANNA, `/api/robots/${seller}/file?path=memory/people/jan-kowalski.md`)).status).toBe(404)
    expect(await index()).not.toContain('jan-kowalski.md')
    const history = (await api<FileHistoryView>(ANNA, `/api/robots/${seller}/file/history?path=memory/people/jan-kowalski.md`)).body
    expect(history.versions.length).toBeGreaterThan(0)
    // Restored, it is back, by the owner.
    expect((await api(ANNA, `/api/robots/${seller}/file/restore?path=memory/people/jan-kowalski.md`, { body: { version: history.versions[0]!.id } })).status).toBe(200)
    expect((await api<{ text?: string }>(ANNA, `/api/robots/${seller}/file?path=memory/people/jan-kowalski.md`)).body.text).toContain('Met.')
    expect(await index()).toContain('jan-kowalski.md')
    // A deleted page that is not there is not "deleted".
    expect((await api(ANNA, `/api/robots/${seller}/file?path=memory/people/nobody.md`, { method: 'DELETE' })).status).toBe(404)
  }, 60_000)
})