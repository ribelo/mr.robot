/**
 * Two persona files and the memory shape (v1.18 ticket 01, rm-2asl, rm-x8nc, rm-d5c5, rm-8le0, rm-ocg4, rm-zoee): SOUL.md and AGENTS.md
 * with MEMORY.md's three sections; IDENTITY.md and TOOLS.md fold into the identity fields, SOUL.md and AGENTS.md with a kept version.
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileHistoryView, FileVersionContent, RobotPanel, WorkspaceFileContent } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

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
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const read = async (id: string, path: string) => (await api<WorkspaceFileContent>(ANNA, `/api/robots/${id}/file?path=${path}`))
const lastRequest = (id: string) => (requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction').at(-1)!

describe('the persona set (rm-2asl, rm-d5c5)', () => {
  it('is SOUL.md, AGENTS.md with tool notes, and MEMORY.md in three sections; the baseline ends with SOUL.md', async () => {
    const id = await robot()
    await turn(id, 'hi', [{ say: 'Hi.' }])
    expect((await read(id, 'IDENTITY.md')).status).toBe(404)
    expect((await read(id, 'TOOLS.md')).status).toBe(404)
    expect((await read(id, 'AGENTS.md')).body.text).toContain('## Tool notes')
    const memory = (await read(id, 'MEMORY.md')).body.text!
    expect(memory.indexOf('## Facts')).toBeLessThan(memory.indexOf('## Preferences'))
    expect(memory.indexOf('## Preferences')).toBeLessThan(memory.indexOf('## Commitments'))
    const baseline = JSON.stringify(lastRequest(id).messages.filter((message) => message.role === 'user'))
    const at = (path: string) => baseline.indexOf(`path=\\"${path}\\"`)
    expect(at('AGENTS.md')).toBeGreaterThan(at('USER.md'))
    expect(at('MEMORY.md')).toBeGreaterThan(at('AGENTS.md'))
    expect(at('SOUL.md')).toBeGreaterThan(at('MEMORY.md'))
    expect(baseline).not.toContain('IDENTITY.md')
    expect(baseline).not.toContain('TOOLS.md')
  })
})

describe('the upgrade from five files (rm-x8nc, rm-8le0)', () => {
  it('folds IDENTITY.md and TOOLS.md, shapes MEMORY.md, keeps a version of each and loses no text', async () => {
    const id = await robot()
    await testRobot(id).oldPersonaForTest({
      'IDENTITY.md': '# IDENTITY.md\n\n- **Name:** Ledger\n- **Title:** Bookkeeper\n- **Character:** a careful clerk\n- **Emoji:** 🧾\n\nI sign every report.\n',
      'TOOLS.md': '# TOOLS.md - Local Notes\n\n- The office printer is "lp-2nd-floor".\n- Host "nas" is the archive.\n',
      'MEMORY.md': '# MEMORY.md\n\nAnna pays invoices on the 10th.\nThe accountant is Ewa.\n',
    }, { name: 'Ledger', title: '', description: '' })
    await turn(id, 'hi', [{ say: 'Hi.' }])

    expect((await read(id, 'IDENTITY.md')).status).toBe(404)
    expect((await read(id, 'TOOLS.md')).status).toBe(404)
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.summary.identity).toMatchObject({ name: 'Ledger', title: 'Bookkeeper' })
    const soul = (await read(id, 'SOUL.md')).body.text!
    expect(soul).toContain('## Identity notes')
    for (const line of ['a careful clerk', '🧾', 'I sign every report.']) expect(soul).toContain(line)
    const agents = (await read(id, 'AGENTS.md')).body.text!
    expect(agents).toContain('"lp-2nd-floor"')
    expect(agents).toContain('Host "nas" is the archive.')
    const memory = (await read(id, 'MEMORY.md')).body.text!
    expect(memory).toMatch(/## Facts\nAnna pays invoices on the 10th\.\nThe accountant is Ewa\.\n\n## Preferences\n\n## Commitments\n$/)

    // The old files are in their history, whole.
    for (const [path, text] of [['IDENTITY.md', 'I sign every report.'], ['TOOLS.md', 'lp-2nd-floor'], ['MEMORY.md', 'Anna pays invoices on the 10th.']] as const) {
      const history = (await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=${path}`)).body
      const kept = (await api<FileVersionContent>(ANNA, `/api/robots/${id}/file/version?path=${path}&version=${history.versions[0]!.id}`)).body
      expect(kept.text).toContain(text)
    }
    // Once only.
    await turn(id, 'again', [{ say: 'Hi.' }])
    expect((await read(id, 'SOUL.md')).body.text!.split('## Identity notes')).toHaveLength(2)
  })
})

describe('the prompt and the memory skill (rm-ocg4, rm-zoee)', () => {
  it('names the three sections in the memory section, and lists the skill memory with the sweep in it', async () => {
    const id = await robot()
    await turn(id, 'hi', [{ say: 'Hi.' }])
    const request = lastRequest(id)
    const system = JSON.stringify(request.messages.filter((message) => message.role === 'system'))
    expect(system).toContain('MEMORY.md: Facts, Preferences, Commitments')
    expect(system).not.toContain('IDENTITY.md')
    expect(JSON.stringify(request.messages)).toContain('- `memory`: What goes where in memory')
    const skill = (await read(id, 'docs/skills/memory/SKILL.md')).body.text!
    expect(skill).toContain('## The memory sweep')
  })
})
