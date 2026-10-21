/**
 * The Trajectory and Rewind (robot-h5v3, robot-0q6a; v1.19 ticket 05): a Rewind opens a chapter seeded with real history up to the
 * point, in the live chapter or an older one; the chapters after it are superseded and stay readable; no note enters the model's
 * context, the next Wake-up's label says what stands; there is no undo.
 */
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RewindView, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf } from './stub-llm.ts'

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
  await testRobot(body.id).activateForTest()
  scripts.set(body.id, [
    { say: 'Noted: blue.' },
    { calls: [{ name: 'react', args: { emoji: '👍' } }] },
    { say: 'Ordered the red one.' },
  ])
  for (const text of ['I like blue.', 'Actually order the red one.']) {
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text } })
    await settle(body.id)
  }
  return body.id
}

const trajectory = async (id: string, chapter?: number) => (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory${chapter === undefined ? '' : `?chapter=${chapter}`}`)).body
const conversation = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
const texts = (chat: Conversation) => chat.items.flatMap((item) => (item.kind === 'message' || item.kind === 'reply' ? [item.text] : []))

async function turn(id: string, text: string, reply: string): Promise<void> {
  scripts.set(id, [{ say: reply }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

describe('the Trajectory and Rewind', () => {
  it('lists every event of the live chapter in order (robot-h5v3)', async () => {
    const id = await robotWithHistory()
    const { events } = await trajectory(id)
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index))
    expect(events.some((event) => event.type === 'tool/ptc-dispatch' && JSON.parse(event.data).name === 'react')).toBe(true)
  })

  it('rewinds in the live chapter: a new chapter of real history, no note in it, the label on the next Wake-up (ec-i74p, ec-utsf)', async () => {
    const id = await robotWithHistory()
    const before = await trajectory(id)
    const regretted = before.events.find((event) => event.type === 'user/message' && event.data.includes('Actually order the red one.'))!
    const atSeq = regretted.seq - 1
    const rewound = await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq } })
    expect(rewound.status).toBe(200)

    const after = await trajectory(id)
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(after.chapters.map((chapter) => [chapter.ordinal, chapter.closedBy, chapter.superseded])).toEqual([[1, 'rewind', false], [2, null, false]])
    // The seed is what the model saw at the point: the first message and its reply, nothing after it, and no note.
    const seed = JSON.stringify(after.events)
    expect(seed).toContain('I like blue.')
    expect(seed).not.toContain('Actually order the red one.')
    expect(seed).not.toContain('external effects')
    expect(after.events.at(-1)).toMatchObject({ type: 'session/end-seed' })

    const chat = await conversation(id)
    expect(texts(chat)).toEqual(['I like blue.', 'Noted: blue.'])
    expect(chat.items.at(-1)).toMatchObject({ kind: 'notice', text: expect.stringContaining('Rewound to') })

    await turn(id, 'what colour?', 'Back to blue.')
    const sent = requests.get(id)!.at(-1)!
    const wake = JSON.stringify(wakeOf(sent))
    expect(wake).toContain('external effects since then stand')
    expect(wake).toContain('react')
    expect(JSON.stringify(sent.messages)).not.toContain('Actually order the red one.')
    // The label is the next Wake-up's only, and the chat shows the message without it.
    await turn(id, 'and now?', 'Still blue.')
    expect(JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))).not.toContain('Rewound to')
    expect(texts(await conversation(id))).toEqual(['I like blue.', 'Noted: blue.', 'what colour?', 'Back to blue.', 'and now?', 'Still blue.'])
  })

  it('rewinds into an older chapter: the chapters after the point are superseded, readable and greyed (ec-i74p, ec-cc6i)', async () => {
    const id = await robotWithHistory()
    const first = await trajectory(id)
    await testRobot(id).closeChapterForTest()
    await turn(id, 'Book the dentist.', 'Booked for Friday.')
    expect((await trajectory(id)).chapters).toHaveLength(2)
    const regretted = first.events.find((event) => event.type === 'user/message' && event.data.includes('Actually order the red one.'))!
    const rewound = await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: regretted.seq - 1, chapter: 1 } })
    expect(rewound.status).toBe(200)

    const after = await trajectory(id)
    expect(after.chapters.map((chapter) => [chapter.ordinal, chapter.closedBy, chapter.superseded])).toEqual([[1, 'compaction', false], [2, 'rewind', true], [3, null, false]])
    expect(texts(await conversation(id))).toEqual(['I like blue.', 'Noted: blue.'])
    // The superseded chapter is read in full, and cannot be rewound to; search leaves it out.
    expect(JSON.stringify((await trajectory(id, 2)).events)).toContain('Book the dentist.')
    expect((await api(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: 3, chapter: 2 } })).status).toBe(409)
    expect((await env.ROBOT.getByName(id).searchConversation('dentist')).items).toEqual([])
    await turn(id, 'what now?', 'Blue it is.')
    const wake = JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))
    expect(wake).toContain('external effects since then stand')
    expect(wake).toContain('say')
  })

  it('rewinding to before a Turn removes its message too; it is not delivered again', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const id = body.id
    await settle(id)
    await testRobot(id).activateForTest()
    scripts.set(id, [{ text: 'First answer.' }, { text: 'Second answer.' }, { text: 'Answer after the rewind.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'first question' } })
    await settle(id)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'second question' } })
    await settle(id)
    const events = (await trajectory(id)).events
    const asked = events.find((event) => event.type === 'user/message' && event.data.includes('second question'))!
    const last = events.filter((event) => event.type === 'turn/start' && event.seq < asked.seq).at(-1)!.turn!
    expect((await api(ANNA, `/api/robots/${id}/rewind`, { body: { beforeTurn: last } })).status).toBe(200)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'third question' } })
    await settle(id)
    const sent = JSON.stringify(requests.get(id)!.at(-1)!.messages)
    expect(sent).toContain('first question')
    expect(sent).not.toContain('second question')
    expect(sent).toContain('third question')
  })

  it('has no undo (ec-cc6i)', async () => {
    const id = await robotWithHistory()
    const rewound = (await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: 5 } })).body
    expect((await api(ANNA, `/api/robots/${id}/rewinds/${rewound.id}/undo`, { body: {} })).status).toBe(404)
  })
})
