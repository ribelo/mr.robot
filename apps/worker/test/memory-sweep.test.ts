/**
 * The memory sweep (v1.18 ticket 03, rm-glmd, rm-5org, rm-hhxa, rm-l4t8): the bounded step before an idle compaction, on the Robot's own
 * model, never during a Turn; skipped when no daily note changed; its writes are versions by the sweep; the Trajectory names them.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, FileHistoryView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

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

async function staff(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, idleCompactionFloorTokens: 0, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function idleMoment(id: string): Promise<void> {
  await testRobot(id).idleDueForTest()
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

const write = (path: string, content: string) => ({ name: 'write', args: { on: 'workspace', file_path: path, content } })
const compacted = async (id: string) => (await env.ROBOT.getByName(id).trajectory()).some((event) => event.type === 'user/message' && event.data.includes('compact-checkpoint'))

describe.each(MODES)('the memory sweep, %s (rm-glmd, rm-5org, rm-hhxa)', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it('reads the changed notes on the Robot\'s model before the compaction, writes as the sweep, and leaves a Trajectory entry', async () => {
    const id = await staff()
    await say(id, 'Remember that I moved to Gdańsk.', [{ calls: [write('memory/2026-10-21.md', '- Anna moved to Gdańsk on 20 October.\n')] }, { say: 'Noted.' }])
    const turnRequests = requests.get(id)!.length
    scripts.set(id, [
      // The snapshot (v1.20) comes first: nothing to add.
      { text: '' },
      { calls: [write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- Anna lives in Gdańsk.\n\n## Preferences\n\n## Commitments\n')] },
      { text: '' },
      { text: 'SUMMARY: Anna moved to Gdańsk.' },
    ])
    await idleMoment(id)
    const sweep = requests.get(id)![turnRequests + 1]!
    expect(sweep.model).toBe('stub')
    const instruction = JSON.stringify(sweep.messages.at(-1))
    expect(instruction).toContain('Memory sweep')
    expect(instruction).toContain('memory/2026-10-21.md')
    expect(instruction).toContain('invent nothing')
    expect(await compacted(id)).toBe(true)

    const history = (await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=MEMORY.md`)).body
    expect(history.current?.by).toBe('the memory sweep')
    const record = (await env.ROBOT.getByName(id).trajectory()).find((event) => event.type === 'plugin:mr-robot/memory-sweep')
    // The chapter closed after the compaction: the record is in the chapter before.
    const old = record ?? (await api<{ events: Array<{ type: string; data: string }> }>(ANNA, `/api/robots/${id}/trajectory?chapter=1`)).body.events.find((event) => event.type === 'plugin:mr-robot/memory-sweep')
    expect(JSON.parse(old!.data)).toEqual({ notes: ['memory/2026-10-21.md'], changed: ['MEMORY.md'] })
    // The Robot's own writes afterwards are its own again.
    await say(id, 'and the cat', [{ calls: [write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- Anna lives in Gdańsk.\n- Anna has a cat.\n\n## Preferences\n\n## Commitments\n')] }, { say: 'Noted.' }])
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=MEMORY.md`)).body.current?.by).toBe('the Robot')
  })

  it('is skipped when no daily note changed since the last sweep; the compaction still runs (rm-l4t8)', async () => {
    const id = await staff()
    await say(id, 'hello', [{ calls: [write('memory/2026-10-21.md', '- hello\n')] }, { say: 'Hi.' }])
    await testRobot(id).sweptAtForTest(Date.now() + 1000)
    const before = requests.get(id)!.length
    scripts.set(id, [{ text: 'SUMMARY: a greeting.' }])
    await idleMoment(id)
    const after = requests.get(id)!.slice(before)
    expect(after.some((request) => JSON.stringify(request.messages.at(-1)).includes('Memory sweep'))).toBe(false)
    expect(after.some((request) => request.purpose === 'compaction')).toBe(true)
  })

  it('never runs during a Turn (rm-5org)', async () => {
    const id = await staff()
    await say(id, 'hello', [{ calls: [write('memory/2026-10-21.md', '- hello\n')] }, { say: 'Hi.' }])
    let open!: () => void
    const gate = new Promise<void>((resolve) => { open = resolve })
    scripts.set(id, [{ gate, then: { say: 'Done.' } }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'work long' } })
    const before = requests.get(id)!.length
    await testRobot(id).idleDueForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    expect(requests.get(id)!.slice(before).some((request) => JSON.stringify(request.messages.at(-1)).includes('Memory sweep'))).toBe(false)
    open()
    await settle(id)
    expect(requests.get(id)!.slice(before).some((request) => JSON.stringify(request.messages.at(-1)).includes('Memory sweep'))).toBe(false)
  })

  it('waits for nothing it refused: a sweep that ran no allowed tool leaves the notes to sweep again (v1.20.1)', async () => {
    const id = await staff()
    await say(id, 'hello', [{ calls: [write('memory/2026-10-21.md', '- hello\n')] }, { say: 'Hi.' }])
    // The snapshot writes nothing; the sweep only tries say, which its fence refuses.
    scripts.set(id, [{ text: '' }, { calls: [{ name: 'say', args: { text: 'Sweeping!' } }] }, { text: '' }, { text: 'SUMMARY: hello.' }])
    await idleMoment(id)
    const sweeps = () => requests.get(id)!.filter((request) => JSON.stringify(request.messages.at(-1)).includes('Memory sweep')).length
    expect(sweeps()).toBe(1)
    await say(id, 'again', [{ say: 'Hi again.' }])
    scripts.set(id, [{ text: '' }, { calls: [write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- hello\n')] }, { text: '' }, { text: 'SUMMARY: again.' }])
    await idleMoment(id)
    expect(sweeps()).toBe(2)
  }, 60_000)

  it('is a Turn of its own: a message during it waits, then runs with every tool (v1.20.1)', async () => {
    const id = await staff()
    await say(id, 'hello', [{ calls: [write('memory/2026-10-21.md', '- hello\n')] }, { say: 'Hi.' }])
    let open!: () => void
    const gate = new Promise<void>((resolve) => { open = resolve })
    // The snapshot's model call waits at the gate while the owner writes.
    scripts.set(id, [{ gate, then: { text: '' } }, { calls: [write('MEMORY.md', '# MEMORY.md\n\n## Facts\n- hello\n')] }, { text: '' }, { say: 'You wrote while I tidied.' }])
    await testRobot(id).idleDueForTest()
    const alarm = runDurableObjectAlarm(env.ROBOT.getByName(id))
    await vi.waitFor(() => expect(requests.get(id)!.some((request) => JSON.stringify(request.messages.at(-1)).includes('Compaction is about to replace'))).toBe(true))
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'are you there?' } })
    open()
    await alarm
    await settle(id)
    const seen = requests.get(id)!
    const message = seen.findIndex((request) => JSON.stringify(request.messages).includes('are you there?'))
    const sweep = seen.findIndex((request) => JSON.stringify(request.messages.at(-1)).includes('Memory sweep'))
    expect(sweep).toBeGreaterThan(0)
    // The message reached the model only after the sweep, in a Turn of its own, and its say ran.
    expect(message).toBeGreaterThan(sweep)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.some((item) => item.kind === 'reply' && item.text === 'You wrote while I tidied.')).toBe(true)
    // The sweep's write is the sweep's; nothing the Turn did is labelled as it.
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=MEMORY.md`)).body.current?.by).toBe('the memory sweep')
  }, 60_000)
})