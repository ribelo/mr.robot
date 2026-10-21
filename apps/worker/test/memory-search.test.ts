/**
 * memory_search and the end of note injection (v1.20 ticket 03, dm-cl1p, dm-hmet, dm-yn3q, dm-vh11, dm-g4in, dm-zpoo).
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { FileHistoryView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const STUB = { provider: 'stub', model: 'stub' }

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function staff(tools: Record<string, string> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow', ...tools }, skills: [], recipients: [], secrets: [] }, subagentModels: [STUB] } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const write = (path: string, content: string) => ({ name: 'write', args: { on: 'workspace', file_path: path, content } })
const results = (request: GenerateOptions) => request.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
type Match = { path: string; scope: string; lines: string; date: string | null; snippet: string }

/** One search in a Turn; its matches. */
async function search(id: string, query: string): Promise<Match[]> {
  await turn(id, `find ${query}`, [{ calls: [{ name: 'memory_search', args: { query } }] }, { say: 'Found.' }])
  const request = requests.get(id)!.findLast((entry) => results(entry).some((text) => text.includes('"matches"')))!
  return (JSON.parse(results(request).findLast((text) => text.includes('"matches"'))!) as { matches: Match[] }).matches
}

describe('daily notes leave the context (dm-cl1p, dm-vh11)', () => {
  it('keeps the notes out of the memory message and tells the Robot to search', async () => {
    const id = await staff()
    const today = new Date().toISOString().slice(0, 10)
    await turn(id, 'remember the dentist', [{ calls: [write(`memory/${today}.md`, '- The dentist is on Friday.\n')] }, { say: 'Noted.' }])
    await testRobot(id).forgetBaselineForTest()
    await turn(id, 'hello', [{ say: 'Hi.' }])
    const context = JSON.stringify(requests.get(id)!.at(-1)!.messages)
    expect(context).toContain('<file path=\\"MEMORY.md\\"')
    expect(context).not.toContain(`<file path=\\"memory/${today}.md\\"`)
    expect(context).toContain('Daily notes are not in your context.')
    expect(context).toContain('call memory_search')
  })
})

describe('memory_search (dm-hmet, dm-yn3q)', () => {
  it('ranks paragraphs over the indexed set with path, lines, date and snippet, and follows every writer', async () => {
    const id = await staff()
    await turn(id, 'notes', [
      { calls: [
        write('memory/2026-10-01.md', '# 2026-10-01\n\n- Anna booked the dentist, Dr. Nowak on Marszałkowska.\n\n- Bought coffee.\n'),
        write('memory/2026-10-15.md', '- The dentist appointment moved to Friday.\n'),
        write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- Anna has a cat called Mruczek.\n\n## Preferences\n\n## Commitments\n'),
        write('notes/dentist.md', 'Not memory: the dentist notes outside the indexed set.\n'),
      ] },
      { say: 'Written.' },
    ])
    const found = await search(id, 'dentist Nowak')
    expect(found[0]).toMatchObject({ path: 'memory/2026-10-01.md', scope: 'robot', lines: '3-3', date: '2026-10-01' })
    expect(found[0]!.snippet).toContain('Dr. Nowak')
    expect(found.map((match) => match.path)).toContain('memory/2026-10-15.md')
    expect(found.map((match) => match.path)).not.toContain('notes/dentist.md')
    // A heading belongs to the paragraph under it.
    expect((await search(id, 'Mruczek'))[0]).toMatchObject({ path: 'MEMORY.md', lines: '3-4', date: null })

    // The owner's edit, and a restore, reindex at once.
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\n\n## Facts\n- Anna has a dog called Burek.\n' } })
    expect(await search(id, 'Mruczek')).toEqual([])
    expect((await search(id, 'Burek'))[0]).toMatchObject({ path: 'MEMORY.md' })
    const versions = (await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=MEMORY.md`)).body.versions
    await api(ANNA, `/api/robots/${id}/file/restore?path=MEMORY.md`, { body: { version: versions[0]!.id } })
    expect((await search(id, 'Mruczek'))[0]).toMatchObject({ path: 'MEMORY.md' })
    // A deleted note leaves the index.
    await api(ANNA, `/api/robots/${id}/file?path=memory/2026-10-15.md`, { method: 'DELETE' })
    expect((await search(id, 'Friday')).map((match) => match.path)).not.toContain('memory/2026-10-15.md')

    // The owner's files and SPACE.md, by their content.
    await api(ANNA, '/api/me/files/USER.md', { method: 'PUT', body: { content: '# USER.md\n- Anna works at Allegro.\n' } })
    await api(ANNA, '/api/admin/space-memory', { method: 'PUT', body: { content: '# SPACE.md\nThe flat\'s heating is by Veolia.\n' } })
    expect((await search(id, 'Allegro'))[0]).toMatchObject({ path: 'USER.md', scope: 'member' })
    expect((await search(id, 'Veolia'))[0]).toMatchObject({ path: 'SPACE.md', scope: 'space' })
  }, 60_000)

  it('indexes a Robot from before the index a bounded number of files per Turn', async () => {
    const id = await staff()
    for (let day = 1; day <= 150; day += 1) {
      const date = new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10)
      await env.FILES.put(`robots/${id}/memory/${date}.md`, `- Day ${day}: nothing special.\n`)
    }
    await testRobot(id).clearMemoryIndexForTest()
    await turn(id, 'hello', [{ say: 'Hi.' }])
    expect(await testRobot(id).memoryIndexedForTest()).toBe(100)
    await turn(id, 'hello again', [{ say: 'Hi.' }])
    expect(await testRobot(id).memoryIndexedForTest()).toBeGreaterThanOrEqual(150)
  }, 60_000)

  it('is a Subagent\'s tool too (dm-g4in)', async () => {
    const id = await staff({ subagents: 'allow' })
    scripts.set(`${id}:sub`, [{ text: 'REPORT: done.' }])
    await turn(id, 'delegate', [{ calls: [{ name: 'subagent', args: { description: 'Look', prompt: 'Look it up.', ...STUB } }] }, { text: 'Started.' }, { say: 'Done.' }])
    const child = requests.get(`${id}:sub`)?.[0]
    expect(child?.tools?.map((entry) => entry.name)).toContain('memory_search')
  }, 60_000)
})