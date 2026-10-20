import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceFileView } from '@mr-robot/protocol'
import { SPILL_KEEP_MS, STAGED_KEEP_MS } from '../src/workspace/spill.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const LINE = (n: number) => `row ${String(n).padStart(4, '0')} ${'x'.repeat(90)}`
const BIG = Array.from({ length: 200 }, (_, index) => LINE(index + 1)).join('\n')

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robot(contextBudget: number): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  await env.FILES.put(`robots/${body.id}/data/big.txt`, BIG)
  return body.id
}

async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** The text of the last tool result the model saw in its latest request. */
function lastToolResult(id: string): string {
  const request = requests.get(id)!.at(-1)!
  const results = JSON.stringify(request.messages)
  return results
}

const spilledPath = (seen: string) => /\/workspace\/(spill\/[^\s"\\)]+\.txt)/.exec(seen)?.[1]

describe('oversized tool results spill to the Workspace (ao-hf02, ao-5lzl, ao-antj)', () => {
  it('a result over the budget reaches the model as head, tail and a Workspace path that read and grep open', async () => {
    const id = await robot(32_000)
    await say(id, 'find the rows', [{ calls: [{ name: 'grep', args: { on: 'workspace', pattern: '^row', glob: 'data/*' } }] }, { text: 'Found them.' }])
    const seen = lastToolResult(id)
    expect(seen).toContain('row 0001')
    expect(seen).toContain('row 0200')
    expect(seen).not.toContain('row 0100')
    expect(seen).toContain('Full formatted result stored at: /workspace/spill/')
    expect(seen).toContain('Use read with offset/limit, or grep this path')
    const path = spilledPath(seen)!
    expect(path).toMatch(/^spill\/[^/]+\/[^/]+-grep\.txt$/)

    // The complete result is a Workspace file: read takes a line range of it, grep finds a line inside it.
    const whole = await env.FILES.get(`robots/${id}/${path}`)
    expect(await whole!.text()).toContain('row 0100')
    await say(id, 'look at the middle', [
      { calls: [{ name: 'read', args: { on: 'workspace', file_path: `/workspace/${path}`, offset: 1, limit: 400 } }, { name: 'grep', args: { on: 'workspace', pattern: 'row 0100', glob: 'spill/**' } }] },
      { text: 'Row 100 is there.' },
    ])
    const after = lastToolResult(id)
    expect(after).toContain('row 0100')
    expect(after).toContain(path)

    // Files lists the spill folder, after every other group.
    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body
    expect(files.find((file) => file.path === path)?.group).toBe('spill')
  })

  it('a Robot with a small context budget spills a result that a large budget keeps inline', async () => {
    const small = await robot(32_000)
    const large = await robot(200_000)
    for (const id of [small, large]) await say(id, 'find the rows', [{ calls: [{ name: 'grep', args: { on: 'workspace', pattern: '^row', glob: 'data/*' } }] }, { text: 'Found them.' }])
    expect(spilledPath(lastToolResult(small))).toBeDefined()
    expect(spilledPath(lastToolResult(large))).toBeUndefined()
    expect(lastToolResult(large)).toContain('row 0100')
  })
})

describe('spill files are tidied after 30 days (ao-ry61)', () => {
  it('the tidy pass removes a spill file older than 30 days and keeps a younger one', async () => {
    const id = await robot(32_000)
    await env.FILES.put(`robots/${id}/spill/s-1/call-1-grep.txt`, 'old result')
    await env.FILES.put(`robots/${id}/notes.md`, 'my notes')
    await testRobot(id).tidySpillForTest(Date.now() + SPILL_KEEP_MS - 60_000)
    expect((await env.FILES.list({ prefix: `robots/${id}/spill/` })).objects).toHaveLength(1)

    await testRobot(id).tidySpillForTest(Date.now() + SPILL_KEEP_MS + 60_000)
    expect((await env.FILES.list({ prefix: `robots/${id}/spill/` })).objects).toEqual([])
    expect(await env.FILES.get(`robots/${id}/notes.md`)).not.toBeNull()
  })

  it('the tidy pass removes a file a copy parked under tmp/ more than a day ago, which a restart left behind (deep review P12)', async () => {
    const id = await robot(32_000)
    const parked = `robots/${id}/tmp/${crypto.randomUUID()}/file`
    await env.FILES.put(parked, 'half a copy')
    await testRobot(id).tidySpillForTest(Date.now() + STAGED_KEEP_MS - 60_000)
    expect(await env.FILES.get(parked)).not.toBeNull()

    await testRobot(id).tidySpillForTest(Date.now() + STAGED_KEEP_MS + 60_000)
    expect((await env.FILES.list({ prefix: `robots/${id}/tmp/` })).objects).toEqual([])
    expect(await env.FILES.get(`robots/${id}/data/big.txt`)).not.toBeNull()
  })
})
