/**
 * v1.20.1 ticket 04: Rewind labels read cold chapters and Subagents (v1.19-review #1, #6); the Turn lock for Rewind and the chapter close
 * (#3, #4); Clear history ordered for a crash (#2); search covers a chapter that went cold unindexed (#5).
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Trajectory } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf, type StubReply } from './stub-llm.ts'

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
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { subagents: 'allow', files: 'allow' }, skills: [], recipients: [], secrets: [] }, subagentModels: [{ provider: 'stub', model: 'stub' }] } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** Thirty more chapters after the first, so the first ages out. */
async function moreChapters(id: string): Promise<void> {
  await testRobot(id).closeChapterForTest()
  for (let index = 2; index <= 32; index += 1) {
    await turn(id, `Message ${index}`, [{ say: `Reply ${index}` }])
    await testRobot(id).closeChapterForTest()
  }
}

describe('Rewind into a cold chapter (v1.19-review #1, #6)', () => {
  it("names the tools used since the point, the Subagent's included, from R2", async () => {
    const id = await robot()
    await turn(id, 'Start here.', [{ say: 'Ready.' }])
    scripts.set(`${id}:sub`, [{ calls: [{ name: 'write', args: { on: 'files', file_path: 'notes/from-child.md', content: 'x' } }] }, { text: 'REPORT: wrote.' }])
    await turn(id, 'Delegate.', [{ calls: [{ name: 'subagent', args: { description: 'Write', prompt: 'Write a note' } }] }, { text: 'Started.' }, { say: 'Done.' }])
    const first = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
    const point = first.events.find((event) => event.type === 'user/message' && event.data.includes('Start here.'))!.seq
    await moreChapters(id)
    expect(await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)).toBeGreaterThan(0)
    expect((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body.chapters[0]!.cold).toBe(true)
    await env.ROBOT.getByName(id).rewind(point, 1)
    await turn(id, 'after the rewind', [{ say: 'Back.' }])
    const label = JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))
    expect(label).toContain('Rewound to')
    expect(label).toContain('subagent')
    expect(label).toContain('write')
    expect(label).not.toContain('no tool was used since then')
  }, 120_000)
})

describe('the Turn lock (v1.19-review #3, #4)', () => {
  it('a Rewind refuses under a running Turn, and a message sent with a Rewind lands in the chapter the Rewind opened', async () => {
    const id = await robot()
    await turn(id, 'one', [{ say: 'One.' }])
    const point = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body.events.find((event) => event.type === 'user/message')!.seq
    let open!: () => void
    const gate = new Promise<void>((resolve) => { open = resolve })
    scripts.set(id, [{ gate, then: { say: 'Two.' } }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'two' } })
    const refused = await api<{ error: string }>(ANNA, `/api/robots/${id}/rewind`, { body: { atSeq: point } })
    expect(refused.status).toBe(409)
    open()
    await settle(id)
    scripts.set(id, [{ say: 'Three.' }])
    const [rewound] = await Promise.all([env.ROBOT.getByName(id).rewind(point), api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'three' } })])
    await settle(id)
    const live = (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).body
    expect(live.sessionId).toBe(rewound.liveSessionId)
    expect(live.events.some((event) => event.type === 'user/message' && event.data.includes('three'))).toBe(true)
    // One parent, one child: no chapter was opened twice from the same one.
    const parents = (await testRobot(id).chaptersForTest()).flatMap((chapter) => (chapter.parent === null ? [] : [`${chapter.parent.sessionId}@${chapter.parent.seq}`]))
    expect(new Set(parents).size).toBe(parents.length)
  }, 60_000)
})

describe('Clear history ordered for a crash (v1.19-review #2)', () => {
  it('leaves a working Robot, and the alarm removes the cold objects a Clear history named', async () => {
    const id = await robot()
    await turn(id, 'hello', [{ say: 'Hi.' }])
    await env.FILES.put(`chapters/${id}/7.json`, '{}')
    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'New robot' } })).status).toBe(200)
    expect((await env.FILES.list({ prefix: `chapters/${id}/` })).objects).toEqual([])
    // As if evicted right after the transaction: the object is still named, and the Robot works meanwhile.
    await env.FILES.put(`chapters/${id}/8.json`, '{}')
    await testRobot(id).coldPurgeForTest([`chapters/${id}/8.json`])
    await turn(id, 'still there?', [{ say: 'Yes.' }])
    expect((await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory`)).status).toBe(200)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    expect((await env.FILES.list({ prefix: `chapters/${id}/` })).objects).toEqual([])
  })
})

describe('search covers every chapter (v1.19-review #5)', () => {
  it('finds a word of a chapter that went cold before it was indexed', async () => {
    const id = await robot()
    await turn(id, 'Remember the zeppelin.', [{ say: 'The zeppelin, noted.' }])
    await moreChapters(id)
    await testRobot(id).forgetSearchForTest()
    await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)
    expect((await env.ROBOT.getByName(id).searchConversation('zeppelin')).items.length).toBeGreaterThan(0)
    // A chapter cold and unindexed from before the fix is read from R2 by the next cold tidy.
    await testRobot(id).forgetSearchForTest()
    expect((await env.ROBOT.getByName(id).searchConversation('zeppelin')).items.length).toBe(0)
    await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)
    expect((await env.ROBOT.getByName(id).searchConversation('zeppelin')).items.length).toBeGreaterThan(0)
  }, 120_000)
})