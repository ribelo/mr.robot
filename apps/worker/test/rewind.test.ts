import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RewindView, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robotWithHistory(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  scripts.set(body.id, [
    { text: 'Noted: blue.' },
    { calls: [{ name: 'react', args: { emoji: '👍' } }] },
    { text: 'Ordered the red one.' },
  ])
  for (const text of ['I like blue.', 'Actually order the red one.']) {
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text } })
    await settle(body.id)
  }
  return body.id
}

const trajectory = async (id: string) => (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
const conversation = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body

describe('the Trajectory and rewind', () => {
  it('lists every event of the Conversation in order (robot-h5v3)', async () => {
    const id = await robotWithHistory()
    const { events } = await trajectory(id)
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index))
    expect(events.some((event) => event.type === 'tool/call' && JSON.parse(event.data).name === 'react')).toBe(true)
  })

  it('rewinds to a point: the new live log is exactly the prefix plus the rewind note (robot-0q6a, robot-acr3)', async () => {
    const id = await robotWithHistory()
    const before = await trajectory(id)
    const regretted = before.events.filter((event) => event.type === 'user/message').at(-1)!
    const atSeq = regretted.seq - 1
    const rewound = await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq } })
    expect(rewound.status).toBe(200)

    const after = await trajectory(id)
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(after.events.slice(0, atSeq + 1)).toEqual(before.events.slice(0, atSeq + 1))
    expect(after.events[atSeq + 1]).toMatchObject({ type: 'session/end-seed' })
    const note = after.events.at(-1)!
    expect(note.type).toBe('agent/inbox/spliced')
    expect(note.data).toContain('external effects still stand')
    expect(note.data).toContain('react')
    expect(after.rewinds).toEqual([expect.objectContaining({ atSeq, archivedSessionId: before.sessionId, liveSessionId: after.sessionId, undone: false })])

    const chat = await conversation(id)
    const texts = chat.items.flatMap((item) => (item.kind === 'message' || item.kind === 'reply' ? [item.text] : []))
    expect(texts).toContain('I like blue.')
    expect(texts).not.toContain('Actually order the red one.')
    expect(texts).not.toContain('Ordered the red one.')

    scripts.set(id, [{ text: 'Back to blue.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what colour?' } })
    await settle(id)
    const seen = JSON.stringify(requests.get(id)!.at(-1)!.messages)
    expect(seen).toContain('external effects still stand')
    expect(seen).not.toContain('Actually order the red one.')
  })

  it('undo makes the archived log live again (robot-8v1t)', async () => {
    const id = await robotWithHistory()
    const before = await trajectory(id)
    const rewound = (await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: 5 } })).body
    const undone = await api<RewindView>(ANNA, `/api/robots/${id}/rewinds/${rewound.id}/undo`, { body: {} })
    expect(undone.body.undone).toBe(true)
    const after = await trajectory(id)
    expect(after.sessionId).toBe(before.sessionId)
    expect(after.events).toEqual(before.events)
    const texts = (await conversation(id)).items.flatMap((item) => (item.kind === 'message' ? [item.text] : []))
    expect(texts).toContain('Actually order the red one.')
    expect((await api(ANNA, `/api/robots/${id}/rewinds/${rewound.id}/undo`, { body: {} })).status).toBe(409)
  })

  it('rewinding to before a Turn removes its message too; it is not delivered again', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const id = body.id
    await settle(id)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
    await testRobot(id).activateForTest()
    scripts.set(id, [{ text: 'First answer.' }, { text: 'Second answer.' }, { text: 'Answer after the rewind.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'first question' } })
    await settle(id)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'second question' } })
    await settle(id)
    const turns = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body.events.filter((event) => event.type === 'turn/start')
    const last = turns.at(-1)!.turn!
    expect((await api(ANNA, `/api/robots/${id}/rewind`, { body: { beforeTurn: last } })).status).toBe(200)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'third question' } })
    await settle(id)
    const sent = JSON.stringify(requests.get(id)!.at(-1)!.messages)
    expect(sent).toContain('first question')
    expect(sent).not.toContain('second question')
    expect(sent).toContain('third question')
  })
})
