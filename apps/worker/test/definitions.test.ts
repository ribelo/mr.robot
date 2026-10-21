/**
 * Robot definitions (v1.18 ticket 04, rm-hjpa, rm-gv6s, rm-tszp, rm-vob8, rm-gxp7, rm-77oh): Save as definition with the owner scrub,
 * the two YAML forms, the sync from the library repository, and the downloaded directory the sync reads back.
 */
import { env, reset, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Result from 'effect/Result'
import type { DefinitionView, Me, RobotSummary } from '@mr-robot/protocol'
import { parseGrants, parseTasks, writeGrants, writeTasks, type GrantsForm, type TasksForm } from '../src/definitions/definition.ts'
import { untar } from '../src/skills/library.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const realFetch = globalThis.fetch

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A gzipped tarball shaped like GitHub's: everything under one "<owner>-<repo>-<sha>/" directory. */
async function githubTarball(files: ReadonlyMap<string, Uint8Array>): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const [path, body] of files) {
    const header = new Uint8Array(512)
    header.set(encoder.encode(`ribelo-library-abc123/${path}`).slice(0, 100), 0)
    header.set(encoder.encode(body.length.toString(8).padStart(11, '0') + '\0'), 124)
    header[156] = '0'.charCodeAt(0)
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  return new Response(new Blob(chunks as unknown as ArrayBuffer[]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

async function sync(files: ReadonlyMap<string, Uint8Array>) {
  const archive = await githubTarball(files)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://api.github.com/repos/acme/library/tarball/main') return new Response(archive)
    return realFetch(input, init)
  }) as typeof fetch
  await api(ANNA, '/api/admin/skills/repository', { method: 'PUT', body: { repo: 'acme/library', ref: 'main', path: 'skills' } })
  return (await api<{ synced: string[]; definitions: string[]; refusedDefinitions: Array<{ slug: string; reason: string }> }>(ANNA, '/api/admin/skills/sync', { body: {} })).body
}

const text = (value: string) => new TextEncoder().encode(value)
const list = async (as: string) => (await api<DefinitionView[]>(as, '/api/definitions')).body

describe('the two YAML forms (rm-tszp)', () => {
  const tasks: TasksForm = { version: 1, tasks: [{ title: 'no', instructions: 'Answer: NO, yes, off.', timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1, 4] }, timeZone: 'Europe/Warsaw' }, enabled: false }] }
  const grants: GrantsForm = { version: 1, tools: { files: 'allow', web: 'ask' }, connectors: [{ kind: 'google', write: true, level: 'ask' }], logins: [{ purpose: 'bank.test', level: 'ask' }], hosts: [{ facet: 'files', level: 'allow' }] }

  it('round-trip, keep "no" a string, and refuse unknown keys', () => {
    const written = writeTasks(tasks)
    expect(written.startsWith('# Written by Mr. Robot.')).toBe(true)
    expect(Result.getOrThrow(parseTasks(written))).toEqual(tasks)
    expect(Result.getOrThrow(parseGrants(writeGrants(grants)))).toEqual(grants)
    expect(Result.getOrThrow(parseTasks('version: 1\ntasks:\n  - title: no\n    instructions: off\n    timing: { kind: unscheduled }\n    enabled: false\n')).tasks[0]).toMatchObject({ title: 'no', instructions: 'off' })
    const unknown = parseGrants(writeGrants(grants).replace('version: 1', 'version: 1\nsecretToken: x'))
    expect(Result.isFailure(unknown)).toBe(true)
    expect(Result.isFailure(parseTasks(written.replace('enabled: false', 'enabled: false\n    connection: c-1')))).toBe(true)
    expect(Result.isFailure(parseTasks(written.replace('enabled: false', 'enabled: true')))).toBe(true)
  })
})

describe('Save as definition (rm-gv6s, rm-gxp7, rm-77oh)', () => {
  it('copies the files, gives the Robot one scrub step, writes the forms with kinds and purposes only, and enters the library', async () => {
    const me = (await api<Me>(ANNA, '/api/me')).body
    await api(ANNA, '/api/secrets/bank', { method: 'PUT', body: { username: 'anna', password: 'pw-1', websites: ['https://online.bank.test/login'], shared: false } })
    const gmail = await env.MEMBER.getByName(me.id).addConnection({ kind: 'google', label: 'Anna mail', account: 'anna@example.com', services: ['gmail'], shared: false, meta: {}, secrets: { token: 't' } })
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const id = body.id
    await settle(id)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow', secrets: 'ask', web: 'deny' }, skills: [], recipients: [], secrets: { bank: 'ask' }, connections: { [gmail.id]: 'allow', [`${gmail.id}:write`]: 'ask' } } } })
    await testRobot(id).activateForTest()
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\n\n## Facts\n- Anna lives at Mokotowska 1.\n- Invoices are due on the 10th.\n\n## Preferences\n\n## Commitments\n' } })
    await api(ANNA, '/api/tasks', { body: { title: 'Weekly invoices', instructions: 'Collect the invoices.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1] } } } })

    scripts.set(id, [
      { calls: [
        { name: 'write', args: { on: 'workspace', file_path: 'definition-draft/bookkeeper/MEMORY.md', content: '# MEMORY.md\n\n## Facts\n- Invoices are due on the 10th.\n\n## Preferences\n\n## Commitments\n' } },
        { name: 'write', args: { on: 'workspace', file_path: 'definition-draft/bookkeeper/README.md', content: '# Bookkeeper\n\nCollects the invoices every week and files them.\n\nThe interview will ask:\n- where the invoices arrive\n' } },
      ] },
      { text: '' },
    ])
    const saved = await api<DefinitionView>(ANNA, `/api/robots/${id}/definition`, { body: { slug: 'bookkeeper' } })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body).toMatchObject({ slug: 'bookkeeper', title: 'Bookkeeper', paragraph: 'Collects the invoices every week and files them.', source: 'robot', published: true, mine: true })
    expect(JSON.stringify(requests.get(id)!.at(-2)!.messages.filter((message) => message.role === 'user'))).toContain('take out everything about your owner')

    const response = await SELF.fetch(`https://mr-robot.test/api/definitions/bookkeeper/archive`, { headers: { 'x-dev-identity': ANNA } })
    expect(response.headers.get('content-type')).toBe('application/gzip')
    const files = await untar(await response.arrayBuffer())
    const read = (path: string) => new TextDecoder().decode(files.get(`robots/bookkeeper/${path}`))
    expect([...files.keys()].sort()).toEqual(['AGENTS.md', 'MEMORY.md', 'README.md', 'SOUL.md', 'grants.yaml', 'tasks.yaml'].map((path) => `robots/bookkeeper/${path}`))
    expect(read('MEMORY.md')).not.toContain('Mokotowska')
    const grants = Result.getOrThrow(parseGrants(read('grants.yaml')))
    expect(grants).toEqual({ version: 1, tools: { files: 'allow', secrets: 'ask' }, connectors: [{ kind: 'google', write: false, level: 'allow' }, { kind: 'google', write: true, level: 'ask' }], logins: [{ purpose: 'bank.test', level: 'ask' }], hosts: [] })
    expect(read('grants.yaml')).not.toContain(gmail.id)
    expect(read('grants.yaml')).not.toContain('Anna mail')
    const tasks = Result.getOrThrow(parseTasks(read('tasks.yaml')))
    expect(tasks.tasks).toEqual([{ title: 'Weekly invoices', instructions: 'Collect the invoices.', timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1] }, timeZone: expect.any(String) }, enabled: false }])
    // The staging copies are gone; the Robot's own files are untouched; a snapshot, with no link back.
    expect((await api(ANNA, `/api/robots/${id}/file?path=definition-draft/bookkeeper/README.md`)).status).toBe(404)
    expect((await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=MEMORY.md`)).body.text).toContain('Mokotowska')
    await api(ANNA, `/api/robots/${id}/file?path=SOUL.md`, { method: 'PUT', body: { content: '# SOUL.md\nChanged later.' } })
    expect(new TextDecoder().decode((await untar(await (await SELF.fetch('https://mr-robot.test/api/definitions/bookkeeper/archive', { headers: { 'x-dev-identity': ANNA } })).arrayBuffer())).get('robots/bookkeeper/SOUL.md'))).not.toContain('Changed later.')

    // The downloaded directory, committed to the repository by hand, comes back as the repository's: git wins, the saved row goes.
    const synced = await sync(files)
    expect(synced.definitions).toEqual(['bookkeeper'])
    expect((await list(ANNA)).map((row) => [row.slug, row.source, row.author])).toEqual([['bookkeeper', 'git', 'the library repository']])
    expect((await list(BEN)).map((row) => row.slug)).toEqual(['bookkeeper'])
    // A saved definition may not take the repository's name.
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/definition`, { body: { slug: 'bookkeeper' } })).status).toBe(400)
  }, 60_000)

  it('keeps a Member\'s saved definition his own until it is published; the sync refuses a broken form and removes a gone one', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(BEN, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    scripts.set(body.id, [{ text: '' }])
    expect((await api(BEN, `/api/robots/${body.id}/definition`, { body: { slug: 'helper' } })).status).toBe(200)
    expect((await list(BEN)).map((row) => [row.slug, row.published])).toEqual([['helper', false]])
    expect(await list(ANNA)).toEqual([])
    expect((await api(BEN, `/api/robots/${body.id}/definition`, { body: { slug: 'Not A Slug' } })).status).toBe(400)

    const first = await sync(new Map([
      ['robots/good/README.md', text('# Good\n\nA good one.\n')],
      ['robots/broken/README.md', text('# Broken\n')],
      ['robots/broken/grants.yaml', text('version: 1\ntools: {}\nconnectors: []\nlogins: []\nhosts: []\nconnection: c-1\n')],
    ]))
    expect(first.definitions).toEqual(['good'])
    expect(first.refusedDefinitions.map((entry) => entry.slug)).toEqual(['broken'])
    expect((await sync(new Map([['robots/other/SOUL.md', text('# SOUL.md\n')]]))).definitions).toEqual(['other'])
    expect((await list(ANNA)).map((row) => row.slug)).toEqual(['other'])
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).status).toBe(200)
  })
})

describe('Add a definition (v1.18 ticket 05, rm-xgau)', () => {
  it('makes a setup Robot with its files, proposes grants.yaml\'s Grants, creates its Tasks paused and asks once', async () => {
    const ben = (await api<Me>(BEN, '/api/me')).body
    const google = await env.MEMBER.getByName(ben.id).addConnection({ kind: 'google', label: 'Ben mail', account: 'ben@example.com', services: ['gmail'], shared: false, meta: {}, secrets: { token: 't' } })
    const grants: GrantsForm = { version: 1, tools: { files: 'allow', tasks: 'allow' }, connectors: [{ kind: 'google', write: false, level: 'allow' }, { kind: 'slack', write: false, level: 'ask' }], logins: [], hosts: [{ facet: 'files', level: 'ask' }] }
    const tasks: TasksForm = { version: 1, tasks: [
      { title: 'Weekly invoices', instructions: 'Collect the invoices.', timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1] }, timeZone: 'Europe/Warsaw' }, enabled: false },
      { title: 'Year-end report', instructions: 'Write the report.', timing: { kind: 'scheduled', at: '2031-12-20T09:00:00.000Z' }, enabled: false },
    ] }
    await sync(new Map([
      ['robots/bookkeeper/README.md', text('# Bookkeeper\n\nCollects the invoices every week.\n\nThe interview will ask:\n- where the invoices arrive\n')],
      ['robots/bookkeeper/SOUL.md', text('# SOUL.md\nI am a careful bookkeeper.\n')],
      ['robots/bookkeeper/MEMORY.md', text('# MEMORY.md\n\n## Facts\n- Invoices are due on the 10th.\n\n## Preferences\n\n## Commitments\n')],
      ['robots/bookkeeper/skills/filing/SKILL.md', text('---\nname: filing\ndescription: How to file an invoice\n---\n# Filing\n')],
      ['robots/bookkeeper/tasks.yaml', text(writeTasks(tasks))],
      ['robots/bookkeeper/grants.yaml', text(writeGrants(grants))],
    ]))
    scripts.set('*', [{ say: 'Hello Ben. Where do your invoices arrive?' }])
    const added = await api<RobotSummary>(BEN, '/api/definitions/bookkeeper/add', { body: {} })
    expect(added.status, JSON.stringify(added.body)).toBe(200)
    const id = added.body.id
    await settle(id)
    expect(added.body).toMatchObject({ status: 'setup', identity: { name: 'Bookkeeper' } })
    const first = JSON.stringify(requests.get(id)![0]!.messages)
    expect(first).toContain('installed from the definition \\"Bookkeeper\\"')
    expect(first).toContain('where the invoices arrive')
    expect(first).toContain('I am a careful bookkeeper.')
    expect((await api<{ text: string }>(BEN, `/api/robots/${id}/file?path=skills/filing/SKILL.md`)).body.text).toContain('# Filing')
    expect((await api(BEN, `/api/robots/${id}/file?path=grants.yaml`)).status).toBe(404)

    scripts.set(id, [{ calls: [{ name: 'setup_complete', args: { purpose: 'File Ben\'s invoices.', tools: { web: 'allow' } } }] }, { say: 'Proposed.' }])
    await api(BEN, `/api/robots/${id}/messages`, { body: { text: 'They arrive by e-mail.' } })
    await settle(id)
    const results = requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
    const result = JSON.parse(results.find((entry) => entry.includes('proposalId'))!) as { proposalId: string; grants: { tools: Record<string, string>; connections: Record<string, string> }; notMet: string[] }
    expect(result.grants.tools).toMatchObject({ files: 'allow', tasks: 'allow' })
    expect(result.grants.tools['web']).not.toBe('allow')
    expect(result.grants.connections).toEqual({ [google.id]: 'allow' })
    expect(result.notMet).toEqual([expect.stringContaining('No slack Connection'), expect.stringContaining('No Host for files')])

    // The open Ask comes with the chat (v1.19 asks).
    const proposal = (await api<{ asks: Array<{ id: string; revision: number }> }>(BEN, `/api/robots/${id}/conversation`)).body.asks.find((entry) => entry.id === result.proposalId)!
    scripts.set(id, [{ say: 'I have two Tasks for you, not running yet: Weekly invoices and Year-end report. Which shall I enable?' }])
    expect((await api(BEN, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })).status).toBe(200)
    await settle(id)
    const mine = (await api<{ tasks: Array<{ title: string; timing: { kind: string; paused?: boolean }; instructions: string }> }>(BEN, `/api/tasks?assignee=robot:${id}&state=all`)).body.tasks
    expect(mine.map((task) => [task.title, task.timing.kind, task.timing.paused ?? null]).sort()).toEqual([['Weekly invoices', 'recurring', true], ['Year-end report', 'unscheduled', null]])
    expect(mine.find((task) => task.title === 'Year-end report')!.instructions).toContain('planned it for 2031-12-20T09:00:00.000Z')
    const wake = JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))
    expect(wake).toContain('Ask your owner once')
    expect(wake).toContain('Weekly invoices')
    // Once: the next Wake-up says nothing about it.
    scripts.set(id, [{ say: 'Fine.' }])
    await api(BEN, `/api/robots/${id}/messages`, { body: { text: 'Enable the weekly one.' } })
    await settle(id)
    expect(JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))).not.toContain('Ask your owner once')
  }, 60_000)
})