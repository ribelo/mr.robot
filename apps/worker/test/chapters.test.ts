/**
 * Chapters (v1.19 ticket 02): a compaction closes the live chapter and opens the next one, seeded with what the model saw; the Robot
 * resumes on the live chapter alone; memory acts as after a compaction; Subagents keep their chapter; old Conversations become chapters.
 */
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { ChatItem, Conversation, RewindView, SubagentView, Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { countSqlReads, stopCountingSqlReads } from './sql-reads.ts'
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
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { subagents: 'allow', files: 'allow' }, skills: [], recipients: [], secrets: [] }, subagentModels: [{ provider: 'stub', model: 'stub' }] } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** A context past its budget: the next step compacts it (the platform's step after a Turn without a say), then a Turn after it. */
async function compacted(id: string): Promise<void> {
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { contextBudget: 8000 } })
  await turn(id, 'first', [{ text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900 }])
  await turn(id, 'second', [{ say: 'After compaction.' }])
  expect((requests.get(id) ?? []).some((request) => request.purpose === 'compaction')).toBe(true)
}

const chatRequests = (id: string) => (requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction')
const userText = (request: GenerateOptions) => JSON.stringify(request.messages.filter((message) => message.role === 'user'))
const trajectory = async (id: string) => (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
const chat = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
const texts = (items: readonly ChatItem[]) => items.flatMap((item) => (item.kind === 'message' || item.kind === 'reply' ? [item.text] : []))

describe('a compaction closes the live chapter and opens the next (ec-7oq8, ec-srfn)', () => {
  it('seeds the next session with the checkpoint, links it to its parent, and keeps the chat whole', async () => {
    const id = await robot()
    await turn(id, 'I like the blue apartment.', [{ say: 'Noted the blue one.' }])
    const old = await trajectory(id)
    await compacted(id)

    const chapters = await testRobot(id).chaptersForTest()
    expect(chapters.map((chapter) => [chapter.ordinal, chapter.state.kind])).toEqual([[1, 'closed'], [2, 'live']])
    const [first, second] = chapters
    expect(first!.state).toMatchObject({ by: 'compaction', superseded: false })
    expect(first!.sessionId).toBe(old.sessionId)
    expect(second!.parent?.sessionId).toBe(first!.sessionId)

    // The live chapter starts with what the model saw: the checkpoint and what followed it, then the inherited marker; not the history.
    const live = await trajectory(id)
    expect(live.sessionId).toBe(second!.sessionId)
    expect(live.events.some((event) => event.type === 'user/message' && event.seq > second!.firstSeq && event.data.includes('second'))).toBe(true)
    const seed = live.events.slice(0, second!.firstSeq + 1)
    expect(seed.at(-1)).toMatchObject({ type: 'session/end-seed' })
    expect(JSON.parse(seed.at(-1)!.data)).toEqual({ inherited: true })
    expect(seed.some((event) => event.type === 'user/message' && event.data.includes('compact-checkpoint') && event.data.includes('<compacted-summary>'))).toBe(true)
    expect(JSON.stringify(seed)).not.toContain('I like the blue apartment.')

    // The model goes on from the checkpoint, its turns counted on.
    await turn(id, 'third', [{ say: 'Third.' }])
    const next = chatRequests(id).at(-1)!
    expect(userText(next)).toContain('<compacted-summary>')
    expect(userText(next)).toContain('second')
    expect(userText(next)).not.toContain('I like the blue apartment.')
    const turns = (await trajectory(id)).events.filter((event) => event.type === 'turn/start').map((event) => event.turn!)
    expect(Math.min(...turns)).toBeGreaterThan(Math.max(...old.events.filter((event) => event.type === 'turn/start').map((event) => event.turn!)))

    // The chat reads as one: every message once, the condensed notice once.
    const items = await chat(id)
    for (const text of ['I like the blue apartment.', 'Noted the blue one.', 'first', 'second', 'After compaction.', 'third', 'Third.']) expect(texts(items).filter((entry) => entry === text)).toHaveLength(1)
    expect(items.filter((item) => item.kind === 'notice' && item.text.startsWith('Earlier conversation condensed'))).toHaveLength(1)
    const found = await env.ROBOT.getByName(id).searchConversation('blue apartment')
    expect(found.items.map((hit) => hit.snippet)).toEqual(['I like the blue apartment.'])
  })

  it('resumes after a sleep from the live chapter alone (ec-7s3l)', async () => {
    const id = await robot()
    await turn(id, 'I like the blue apartment.', [{ say: 'Noted.' }])
    await compacted(id)
    const live = (await testRobot(id).chaptersForTest()).at(-1)!
    await testRobot(id).restartForTest().catch(() => undefined)
    countSqlReads()
    await testRobot(id).resumeForTest()
    const reads = stopCountingSqlReads().filter((read) => /FROM session_event/.test(read.query))
    expect(reads.length).toBeGreaterThan(0)
    expect(new Set(reads.map((read) => read.bindings[0]))).toEqual(new Set([live.sessionId]))
  })

  it('keeps one memory baseline across the boundary; a later edit is a change note (ec-ndqf)', async () => {
    const id = await robot()
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nAnna pays bills on the 10th.' } })
    await compacted(id)
    await turn(id, 'third', [{ say: 'Third.' }])
    const after = chatRequests(id).at(-1)!
    expect(userText(after).split('Your memory and persona files as of now').length - 1).toBe(1)
    expect(userText(after)).toContain('Anna pays bills on the 10th.')
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nAnna pays bills on the 12th.' } })
    await turn(id, 'fourth', [{ say: 'Fourth.' }])
    const changed = chatRequests(id).at(-1)!
    expect(userText(changed).split('Your memory and persona files as of now').length - 1).toBe(1)
    expect(JSON.stringify(changed.messages.filter((message) => message.role === 'user').at(-1))).toContain('changed: MEMORY.md by your owner')
  })

  it('keeps a Subagent in the chapter it ran in (ec-h8ib)', async () => {
    const id = await robot()
    scripts.set(`${id}:sub`, [{ text: 'REPORT: read both pages.' }])
    await turn(id, 'go', [{ calls: [{ name: 'subagent', args: { description: 'Read the pages', prompt: 'Read A' } }] }, { text: 'Started.' }, { say: 'Got the report.' }])
    const [child] = (await api<SubagentView[]>(ANNA, `/api/robots/${id}/subagents`)).body
    expect(child).toMatchObject({ status: 'done' })
    const first = (await testRobot(id).chaptersForTest())[0]!
    await compacted(id)
    expect(await testRobot(id).chaptersForTest()).toHaveLength(2)
    expect((await api<SubagentView[]>(ANNA, `/api/robots/${id}/subagents`)).body.map((row) => row.id)).toEqual([child!.id])
    expect((await api(ANNA, `/api/robots/${id}/subagents/${child!.id}/conversation`)).status).toBe(200)
    expect((await chat(id)).filter((item) => item.kind === 'delegation').map((item) => item.kind === 'delegation' && item.subagentId)).toEqual([child!.id])
    expect(await testRobot(id).subagentChapterForTest(child!.id)).toBe(first.sessionId)
  })
})

describe('the upgrade registers old Conversations as chapters (ec-eaz3)', () => {
  it('links rewinds as chapters, an undone one superseded, and renders the same chat', async () => {
    const id = await robot()
    for (const [text, reply] of [['I like blue.', 'Noted: blue.'], ['Actually red.', 'Red then.'], ['Or green.', 'Green.']]) await turn(id, text!, [{ say: reply! }])
    const events = (await trajectory(id)).events
    const at = (text: string) => events.find((event) => event.type === 'user/message' && event.data.includes(text))!.seq - 1
    const undone = (await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: at('Or green.') } })).body
    expect((await api(ANNA, `/api/robots/${id}/rewinds/${undone.id}/undo`, { body: {} })).status).toBe(200)
    const kept = (await api<RewindView>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: at('Actually red.') } })).body
    await turn(id, 'Yellow?', [{ say: 'Yellow.' }])
    const before = await chat(id)
    expect(texts(before)).toEqual(['I like blue.', 'Noted: blue.', 'Yellow?', 'Yellow.'])

    await testRobot(id).unchapterForTest()
    const chapters = await testRobot(id).chaptersForTest()
    expect(chapters.map((chapter) => chapter.sessionId)).toEqual([kept.archivedSessionId, undone.liveSessionId, kept.liveSessionId])
    expect(chapters[0]).toMatchObject({ cut: kept.atSeq, state: { kind: 'closed', by: 'rewind', superseded: false } })
    expect(chapters[1]).toMatchObject({ state: { kind: 'closed', by: 'rewind', superseded: true } })
    expect(chapters[2]).toMatchObject({ parent: { sessionId: kept.archivedSessionId, seq: kept.atSeq }, firstSeq: kept.atSeq + 1, state: { kind: 'live' } })
    expect(await chat(id)).toEqual(before)
  })
})
