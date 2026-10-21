/**
 * The snapshot before compaction (v1.20 ticket 01, dm-kg1p, dm-77dg, dm-tjlb, dm-r6km, dm-pifl): in a Turn, when pressure would
 * compact, the Robot gets three steps to write what is in flight, with the Workspace file tools only; then the compaction runs. Idle, it
 * comes before the sweep; it is skipped when nothing happened. Its writes are versions by the snapshot, its usage is memory's.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, FileHistoryView, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const NOTE = 'Compaction is about to replace your context with a summary.'

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
})

async function staff(settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, ...settings, grants: { tools: ['files', 'box'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const write = (path: string, content: string, on = 'files') => ({ name: 'write', args: { on, file_path: path, content } })
const allEvents = async (id: string) => {
  const live = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
  const older = await Promise.all(live.chapters.filter((chapter) => chapter.ordinal !== live.chapter).map(async (chapter) => (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory?chapter=${chapter.ordinal}`)).body.events))
  return [...older.flat(), ...live.events]
}

describe.each(MODES)('the snapshot in a Turn, %s (dm-kg1p, dm-77dg, dm-r6km, dm-pifl)', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })
  it('runs three steps with the Workspace file tools only before a mid-Turn compaction, then the compaction and the Turn go on', async () => {
    const id = await staff({ contextBudget: 8000 })
    await turn(id, 'Find me a flat.', [
      { text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900, calls: [{ name: 'read', args: { on: 'files', file_path: 'SOUL.md' } }] },
      // The step at the boundary is the Turn's own: the instruction reaches the model at the next one.
      { calls: [{ name: 'read', args: { on: 'files', file_path: 'AGENTS.md' } }] },
      // The snapshot's three steps: a note, a refused say and a refused Box write, then MEMORY.md.
      { calls: [write('memory/2026-10-21.md', '- In flight: the flat search; Mokotowska at 1.2 M PLN found.\n')] },
      { calls: [{ name: 'say', args: { text: 'Hello?' } }, write('notes.md', 'x', 'box')] },
      { calls: [write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- Anna looks for a flat in Warsaw.\n\n## Preferences\n\n## Commitments\n')] },
      // The compaction's summary (DSH may compact more than once to get under its threshold), then the Turn's work goes on.
      ...Array.from({ length: 4 }, (): StubReply => (request) => (request.purpose === 'compaction' ? { text: 'SUMMARY: Anna looks for a flat; Mokotowska found.' } : { say: 'Found one on Mokotowska.' })),
    ])
    const seen = requests.get(id)!
    const steered = seen.findIndex((request) => JSON.stringify(request.messages).includes(NOTE))
    expect(steered).toBeGreaterThan(0)
    expect(JSON.stringify(seen[steered]!.messages)).toContain('then go on with your work')
    const compaction = seen.findIndex((request) => request.purpose === 'compaction')
    expect(compaction).toBe(steered + 3)
    // The fence: say and a write on the Box were refused while the snapshot ran.
    const refusals = JSON.stringify(seen[steered + 2]!.messages.filter((message) => message.role === 'tool'))
    expect(refusals).toContain('say is not available during the snapshot')
    expect(refusals).toContain('a memory step writes only on your Files')
    // After it the fence is gone: the Turn's say runs.
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.some((item) => item.kind === 'reply' && item.text === 'Found one on Mokotowska.')).toBe(true)

    const note = (await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=memory/2026-10-21.md`)).body
    expect(note.current?.by).toBe('the snapshot')
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=MEMORY.md`)).body.current?.by).toBe('the snapshot')
    const record = (await allEvents(id)).find((event) => event.type === 'plugin:mr-robot/snapshot')
    expect(JSON.parse(record!.data).paths.sort()).toEqual(['MEMORY.md', 'memory/2026-10-21.md'])
    const usage = await testRobot(id).usageBySourceForTest()
    expect(usage['memory']).toBeGreaterThan(0)
    expect(usage['robot']).toBeGreaterThan(0)
    // The Robot's own writes afterwards are its own.
    await turn(id, 'and a garage', [{ calls: [write('memory/2026-10-21.md', '- Anna wants a garage too.\n')] }, { say: 'Noted.' }])
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=memory/2026-10-21.md`)).body.current?.by).toBe('the Robot')
  }, 60_000)
})

describe.each(MODES)('the snapshot hands the Turn back, %s (v1.20.1)', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it('a Turn that ends inside its snapshot says through the safety net, and the compaction follows the snapshot', async () => {
    const id = await staff({ contextBudget: 8000 })
    await turn(id, 'Find me a flat.', [
      { text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900, calls: [{ name: 'read', args: { on: 'files', file_path: 'SOUL.md' } }] },
      { calls: [{ name: 'read', args: { on: 'files', file_path: 'AGENTS.md' } }] },
      // The snapshot's first step: the note, then the model ends the Turn.
      { calls: [write('memory/2026-10-21.md', '- In flight: the flat search.\n')] },
      { text: 'Noted the search.' },
    ])
    const snapshots = () => requests.get(id)!.filter((request) => JSON.stringify(request.messages.at(-1)).includes(NOTE)).length
    expect(snapshots()).toBe(1)
    // The safety net ran with every tool: the owner got the last words or a say, not a refusal.
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.some((item) => item.kind === 'reply')).toBe(true)
    // The compaction it was for runs after it (here in the safety net's step), with the note already written.
    const seen = requests.get(id)!
    const snapshotAt = seen.findIndex((request) => JSON.stringify(request.messages.at(-1)).includes(NOTE))
    expect(seen.findIndex((request) => request.purpose === 'compaction')).toBeGreaterThan(snapshotAt)
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=memory/2026-10-21.md`)).body.current?.by).toBe('the snapshot')
  }, 60_000)
})

describe.each(MODES)('the snapshot while idle, %s (dm-kg1p, dm-tjlb)', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })
  async function idleMoment(id: string): Promise<void> {
    await testRobot(id).idleDueForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
  }

  it('comes before the sweep and the compaction, with its own instruction; it is skipped when nothing happened since the last one', async () => {
    const id = await staff({ idleCompactionFloorTokens: 0 })
    await turn(id, 'I moved to Gdańsk.', [{ calls: [write('memory/2026-10-21.md', '- Anna moved to Gdańsk.\n')] }, { say: 'Noted.' }])
    const before = requests.get(id)!.length
    scripts.set(id, [{ calls: [write('memory/2026-10-21.md', '- Anna moved to Gdańsk.\n- In flight: nothing.\n')] }, { text: '' }, { text: '' }, { text: 'SUMMARY: moved.' }])
    await idleMoment(id)
    const after = requests.get(id)!.slice(before)
    expect(JSON.stringify(after[0]!.messages.at(-1))).toContain(`${NOTE} Write to your daily note`)
    expect(JSON.stringify(after[0]!.messages.at(-1))).toContain('Then end.')
    expect(JSON.stringify(after[2]!.messages.at(-1))).toContain('Memory sweep')
    expect(after.at(-1)!.purpose).toBe('compaction')
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=memory/2026-10-21.md`)).body.current?.by).toBe('the snapshot')
    expect((await testRobot(id).usageBySourceForTest())['memory']).toBeGreaterThan(0)

    // Nothing since: a second idle compaction has no snapshot (and no sweep: no note changed).
    await testRobot(id).planIdleForTest()
    const again = requests.get(id)!.length
    scripts.set(id, [{ text: 'SUMMARY: still moved.' }])
    await idleMoment(id)
    expect(requests.get(id)!.slice(again).some((request) => JSON.stringify(request.messages.at(-1)).includes(NOTE))).toBe(false)
  }, 60_000)
})