/**
 * v1.20.1 ticket 05: Add answers a RobotSummary and makes one Robot (v1.18-review #1); the admin sees every definition (#3); a broken repository
 * form keeps the last good one (#4); the scrub reads tasks.yaml and README, writes only under its draft, and must finish (#7, #15; v1.20-review
 * #2); file history older than 90 days goes in the daily tidy (#13); the Grok fetch is bounded (#17).
 */
import { env, reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DefinitionView, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const DAY = 86_400_000
const realFetch = globalThis.fetch

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
afterEach(() => {
  programmed.on = false
  globalThis.fetch = realFetch
})

async function githubTarball(files: ReadonlyMap<string, string>): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const [path, text] of files) {
    const body = encoder.encode(text)
    const header = new Uint8Array(512)
    header.set(encoder.encode(`acme-library-abc/${path}`).slice(0, 100), 0)
    header.set(encoder.encode(body.length.toString(8).padStart(11, '0') + '\0'), 124)
    header[156] = '0'.charCodeAt(0)
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  return new Response(new Blob(chunks as unknown as ArrayBuffer[]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

async function sync(files: ReadonlyMap<string, string>) {
  const archive = await githubTarball(files)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://api.github.com/repos/acme/library/tarball/main') return new Response(archive)
    return realFetch(input, init)
  }) as typeof fetch
  await api(ANNA, '/api/admin/skills/repository', { method: 'PUT', body: { repo: 'acme/library', ref: 'main', path: 'skills' } })
  return (await api<{ refusedDefinitions: Array<{ slug: string }> }>(ANNA, '/api/admin/skills/sync', { body: {} })).body
}

const GOOD = new Map([['robots/helper/README.md', '# Helper\n\nHelps.\n'], ['robots/helper/SOUL.md', '# SOUL.md\nHelpful.\n']])

describe('the Marketplace (v1.18-review #1, #3, #4)', () => {
  it('Add answers the Robot as the list shows it, and a repeated Add makes no second Robot', async () => {
    await sync(GOOD)
    scripts.set('*', [{ say: 'Hello.' }])
    const first = await api<RobotSummary>(BEN, '/api/definitions/helper/add', { body: {} })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id: expect.any(String), ownerName: expect.any(String), unread: expect.any(Boolean), status: 'setup' })
    await settle(first.body.id)
    const again = await api<RobotSummary>(BEN, '/api/definitions/helper/add', { body: {} })
    expect(again.body.id).toBe(first.body.id)
    expect((await api<RobotSummary[]>(BEN, '/api/robots')).body.filter((robot) => robot.kind === 'robot')).toHaveLength(1)
  })

  it("shows the admin a Member's unpublished definition, and keeps the last good copy of a broken repository form", async () => {
    await sync(GOOD)
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(BEN, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    scripts.set(body.id, [{ text: '' }])
    expect((await api(BEN, `/api/robots/${body.id}/definition`, { body: { slug: 'bens' } })).status).toBe(200)
    const admin = (await api<DefinitionView[]>(ANNA, '/api/definitions')).body
    expect(admin.map((row) => [row.slug, row.published]).sort()).toEqual([['bens', false], ['helper', true]])
    const broken = new Map([...GOOD, ['robots/helper/grants.yaml', 'version: 1\nconnection: c-1\n']])
    expect((await sync(broken)).refusedDefinitions.map((entry) => entry.slug)).toEqual(['helper'])
    const helper = (await api<DefinitionView[]>(BEN, '/api/definitions')).body.find((row) => row.slug === 'helper')
    expect(helper).toMatchObject({ title: 'Helper', invalid: expect.stringContaining('grants.yaml') })
    await sync(GOOD)
    expect((await api<DefinitionView[]>(BEN, '/api/definitions')).body.find((row) => row.slug === 'helper')!.invalid).toBeUndefined()
  })
})

describe('Save as definition (v1.18-review #7, #15; v1.20-review #2)', () => {
  async function staff(): Promise<string> {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: ['files', 'tasks'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(body.id).activateForTest()
    return body.id
  }
  const write = (path: string, content: string) => ({ name: 'write', args: { on: 'workspace', file_path: path, content } })

  it('stages tasks.yaml and README for the scrub, in code mode, and refuses a write outside the draft', async () => {
    const id = await staff()
    await api(ANNA, '/api/tasks', { body: { title: 'Call Anna Kowalska', instructions: 'Ring Anna Kowalska at Mokotowska 1.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1] } } } })
    scripts.set(id, [
      { calls: [{ name: 'read', args: { on: 'workspace', file_path: 'definition-draft/caller/tasks.yaml' } }, write('MEMORY.md', 'taken')] },
      (request) => {
        const seen = JSON.stringify(request.messages)
        expect(seen).toContain('Ring Anna Kowalska')
        expect(seen).toContain('the scrub writes only under definition-draft/caller/')
        return { calls: [write('definition-draft/caller/tasks.yaml', '# Written by Mr. Robot.\nversion: 1\ntasks:\n  - title: Call the customer\n    instructions: Ring the customer.\n    timing:\n      kind: recurring\n      schedule:\n        kind: weekly\n        time: "09:00"\n        weekdays: [1]\n      timeZone: UTC\n    enabled: false\n')] }
      },
      { text: '' },
    ])
    const saved = await api<DefinitionView>(ANNA, `/api/robots/${id}/definition`, { body: { slug: 'caller' } })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect((await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=MEMORY.md`)).body.text).not.toBe('taken')
    const tasks = await (await env.FILES.get('definitions/caller/tasks.yaml'))!.text()
    expect(tasks).not.toContain('Kowalska')
    expect(tasks).toContain('Ring the customer.')
  }, 60_000)

  it('saves nothing when the scrub is cut at its step limit', async () => {
    const id = await staff()
    scripts.set(id, Array.from({ length: 10 }, (): StubReply => ({ calls: [{ name: 'read', args: { on: 'workspace', file_path: 'SOUL.md' } }] })))
    const refused = await api<{ error: string }>(ANNA, `/api/robots/${id}/definition`, { body: { slug: 'unfinished' } })
    expect(refused.status).toBe(409)
    expect((await env.FILES.list({ prefix: 'definitions/unfinished/' })).objects).toEqual([])
    expect((await env.FILES.list({ prefix: `robots/${id}/definition-draft/` })).objects).toEqual([])
  }, 60_000)
})

describe('file history and the Grok fetch (v1.18-review #13, #17)', () => {
  it('drops versions older than 90 days in the daily tidy, also of a file not written since', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).oldVersionForTest('MEMORY.md', Date.now() - 100 * DAY)
    expect((await env.FILES.list({ prefix: `history/robots/${body.id}/MEMORY.md/` })).objects).toHaveLength(1)
    await testRobot(body.id).tidyForTest(Date.now())
    expect((await env.FILES.list({ prefix: `history/robots/${body.id}/MEMORY.md/` })).objects).toHaveLength(0)
  })

  it('refuses a page over 5 MB and a redirect; another host is refused before any fetch', async () => {
    let fetched = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === 'https://x.ai/bot/marketplace/bots/huge') {
        fetched += 1
        return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < 6; index += 1) controller.enqueue(new Uint8Array(1024 * 1024)); controller.close() } }))
      }
      if (url === 'https://x.ai/bot/marketplace/bots/moved') return new Response(null, { status: 302, headers: { location: 'https://evil.test/' } })
      return realFetch(input, init)
    }) as typeof fetch
    expect((await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/huge' } })).body.error).toContain('larger than 5 MB')
    expect((await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/moved' } })).body.error).toContain('redirect')
    expect((await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://evil.test/bot/marketplace/bots/x' } })).body.error).toContain('Grok Bot marketplace page')
    expect(fetched).toBe(1)
  })

  it('stops waiting for a slow server after 15 seconds', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url !== 'https://x.ai/bot/marketplace/bots/slow') return realFetch(input, init)
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    }) as typeof fetch
    const started = Date.now()
    const slow = await api<{ error: string }>(BEN, '/api/definitions/import', { body: { url: 'https://x.ai/bot/marketplace/bots/slow' } })
    expect(slow.body.error).toContain('within 15 seconds')
    expect(Date.now() - started).toBeGreaterThanOrEqual(14_000)
  }, 30_000)
})