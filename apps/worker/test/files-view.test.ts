import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceFileContent, WorkspaceFileView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

describe('the Files view (v1.1 ticket 08)', () => {
  it('lists the seeded files with persona and memory first; an owner edit reaches the next Turn (rb-1miy, rb-q5eb, rb-xwks)', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${body.id}/files`)).body
    expect(files.slice(0, 5).map((file) => file.path)).toEqual(['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md'])
    expect(files.slice(0, 5).every((file) => file.group === 'persona')).toBe(true)

    const saved = await api<WorkspaceFileContent>(ANNA, `/api/robots/${body.id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\n\nThe owner pays invoices on the 10th.\n' } })
    expect(saved.body.text).toContain('pays invoices on the 10th')
    expect((await api<WorkspaceFileContent>(ANNA, `/api/robots/${body.id}/file?path=MEMORY.md`)).body.text).toContain('pays invoices on the 10th')
    // Only the owner edits.
    expect((await api(BEN, `/api/robots/${body.id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: 'x' } })).status).toBeGreaterThanOrEqual(400)

    scripts.set(body.id, [{ text: 'Noted.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'hi' } })
    await settle(body.id)
    const sent = JSON.stringify(requests.get(body.id)!.at(-1)!.messages)
    expect(sent).toContain('changed: MEMORY.md by your owner')
    expect(sent).toContain('pays invoices on the 10th')
  })

  it('opens a binary file read-only with a size note', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).saveScreenForTest()
    const shot = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${body.id}/files`)).body.find((file) => file.group === 'screens')!
    const opened = (await api<WorkspaceFileContent>(ANNA, `/api/robots/${body.id}/file?path=${encodeURIComponent(shot.path)}`)).body
    expect(opened).toMatchObject({ text: null, readOnly: true })
    expect(opened.note).toContain('binary file')
  })
})
