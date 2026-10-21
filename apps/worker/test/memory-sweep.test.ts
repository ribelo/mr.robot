/**
 * The memory sweep (v1.18 ticket 03, rm-glmd, rm-5org, rm-hhxa, rm-l4t8): the bounded step before an idle compaction, on the Robot's own
 * model, never during a Turn; skipped when no daily note changed; its writes are versions by the sweep; the Trajectory names them.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FileHistoryView } from '@mr-robot/protocol'
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

async function staff(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, idleCompactionFloorTokens: 0, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } } })
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

describe('the memory sweep (rm-glmd, rm-5org, rm-hhxa)', () => {
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
})
