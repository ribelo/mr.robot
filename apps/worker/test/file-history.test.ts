/**
 * File history (v1.18 ticket 02, rm-d68k, rm-7jo4, rm-xusr, rm-cvl8): every write to a persona, memory or Member file keeps the version
 * it replaces with who wrote it; the API lists, reads and restores (a new version); history is bounded; change notes name who.
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileHistoryView, FileVersionContent, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const DAY = 86_400_000

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' }, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const save = (id: string, content: string) => api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content } })
const history = async (id: string, path = 'MEMORY.md') => (await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=${path}`)).body
const userText = (id: string) => JSON.stringify((requests.get(id) ?? []).at(-1)!.messages.filter((message) => message.role === 'user'))

describe('file history of a Robot (rm-d68k, rm-7jo4)', () => {
  it('keeps each version with who wrote it, reads one, and restores it as a new version the Robot hears about', async () => {
    const id = await robot()
    await save(id, '# MEMORY.md\nOwner wrote one.')
    await turn(id, 'note it', [{ calls: [{ name: 'write', args: { on: 'workspace', file_path: 'MEMORY.md', content: '# MEMORY.md\nThe Robot wrote two.' } }] }, { say: 'Noted.' }])
    await save(id, '# MEMORY.md\nOwner wrote three.')

    const listed = await history(id)
    expect(listed.current).toMatchObject({ by: 'Anna' })
    // Newest first: the Robot's version, the owner's first one, the template the platform wrote.
    expect(listed.versions.map((version) => version.by)).toEqual(['the Robot', 'Anna', 'the platform'])
    const robotVersion = listed.versions[0]!
    const read = (await api<FileVersionContent>(ANNA, `/api/robots/${id}/file/version?path=MEMORY.md&version=${robotVersion.id}`)).body
    expect(read.text).toBe('# MEMORY.md\nThe Robot wrote two.')

    const restored = await api<{ text: string }>(ANNA, `/api/robots/${id}/file/restore?path=MEMORY.md`, { body: { version: robotVersion.id } })
    expect(restored.body.text).toBe('# MEMORY.md\nThe Robot wrote two.')
    const after = await history(id)
    expect(after.current?.by).toBe('Anna (restored an earlier version)')
    expect(after.versions.map((version) => version.by)).toEqual(['Anna', 'the Robot', 'Anna', 'the platform'])
    await turn(id, 'what changed?', [{ say: 'I see.' }])
    expect(userText(id)).toMatch(/changed: MEMORY\.md by [^\n]*your owner \(restored an earlier version\)/)
    // A file outside the persona and memory has no history.
    expect((await api(ANNA, `/api/robots/${id}/file/history?path=notes/a.md`)).status).toBe(400)
  })

  it('keeps a deleted file to restore, and only the last 50 versions and 90 days (rm-xusr)', async () => {
    const id = await robot()
    for (let index = 0; index < 53; index += 1) await save(id, `# MEMORY.md\nversion ${index}`)
    const many = await history(id)
    expect(many.versions).toHaveLength(50)
    expect(many.versions[0]!.size).toBe(new TextEncoder().encode('# MEMORY.md\nversion 51').length)
    expect((await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'DELETE' })).status).toBe(200)
    const deleted = await history(id)
    expect(deleted.current).toBeNull()
    const last = (await api<FileVersionContent>(ANNA, `/api/robots/${id}/file/version?path=MEMORY.md&version=${deleted.versions[0]!.id}`)).body
    expect(last.text).toBe('# MEMORY.md\nversion 52')
    await testRobot(id).trimHistoryForTest('MEMORY.md', Date.now() + 91 * DAY)
    expect((await history(id)).versions).toEqual([])
  })
})

describe('file history of Member files (rm-d68k, rm-cvl8)', () => {
  it('names the owner and Mr. Robot, and restores a version every Robot hears about', async () => {
    const id = await robot()
    await api(ANNA, '/api/me/files/USER.md', { method: 'PUT', body: { content: '# USER.md\nCall me Anna.' } })
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false } })
    await turn(mr, 'remember coffee', [{ calls: [{ name: 'memory_write_shared', args: { file: 'USER.md', content: '# USER.md\nLikes coffee.' } }] }, { say: 'Saved.' }])
    const listed = (await api<FileHistoryView>(ANNA, '/api/me/files/USER.md/history')).body
    expect(listed.current?.by).toBe('Mr. Robot')
    expect(listed.versions.map((version) => version.by)[0]).toBe('Anna')
    expect((await api(ANNA, '/api/me/files/USER.md/restore', { body: { version: listed.versions[0]!.id } })).status).toBe(200)
    expect((await api<{ content: string }>(ANNA, '/api/me/files/USER.md')).body.content).toBe('# USER.md\nCall me Anna.')
    expect((await api<FileHistoryView>(ANNA, '/api/me/files/USER.md/history')).body.current?.by).toBe('Anna (restored an earlier version)')
    await turn(id, 'anything new?', [{ say: 'Yes.' }])
    expect(userText(id)).toMatch(/changed: USER\.md by [^\n]*Mr\. Robot, your owner \(restored an earlier version\)/)
  })
})
