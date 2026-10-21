/**
 * Cold chapters (v1.19 ticket 06): outside the window (the last 30 chapters or 60 days, whichever keeps more) a chapter moves to R2;
 * the chat does not notice; its Trajectory and its Subagents read from R2; delete and the resets remove them.
 */
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem, Trajectory } from '@mr-robot/protocol'
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
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { subagents: 'allow' }, skills: [], recipients: [], secrets: [] }, subagentModels: [{ provider: 'stub', model: 'stub' }] } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** 33 chapters: the first has a delegation; each closes after its Turn, as after a compaction. */
async function chapters(id: string): Promise<void> {
  scripts.set(`${id}:sub`, [{ text: 'REPORT: the zeppelin pages.' }])
  await turn(id, 'Read about the zeppelin.', [{ calls: [{ name: 'subagent', args: { description: 'Read', prompt: 'Read the zeppelin pages' } }] }, { text: 'Started.' }, { say: 'Read it.' }])
  await testRobot(id).closeChapterForTest()
  for (let index = 2; index <= 33; index += 1) {
    await turn(id, `Message ${index}`, [{ say: `Reply ${index}` }])
    await testRobot(id).closeChapterForTest()
  }
}

const trajectory = async (id: string, chapter?: number) => (await api<Trajectory>(ANNA, `/api/robots/${id}/trajectory${chapter === undefined ? '' : `?chapter=${chapter}`}`)).body
const whole = async (id: string) => (await testRobot(id).conversationView()).items
const strip = (items: readonly ChatItem[]) => items.map((item) => JSON.stringify(item))
const coldKeys = async (id: string) => (await env.FILES.list({ prefix: `chapters/${id}/` })).objects.map((object) => object.key)

describe('cold chapters in R2 (ec-4qsf, ec-aly5, ec-2rdv)', () => {
  it('moves the chapters outside the window, keeps the chat, and reads a cold Trajectory and Subagent from R2', async () => {
    const id = await robot()
    await chapters(id)
    const before = { chat: strip(await whole(id)), first: await trajectory(id, 1), list: (await trajectory(id)).chapters }
    expect(before.list.length).toBe(34)

    // Within 60 days nothing goes, even past the last 30 chapters: whichever keeps more.
    expect(await testRobot(id).tidyChaptersForTest(Date.now())).toBe(0)
    // 61 days later, the chapters before the last 30 go.
    expect(await testRobot(id).tidySpillForTest(Date.now() + 61 * DAY)).toBeUndefined()
    const listed = (await trajectory(id)).chapters
    expect(listed.filter((chapter) => chapter.cold === true).map((chapter) => chapter.ordinal)).toEqual([1, 2, 3, 4])
    expect(await coldKeys(id)).toEqual([1, 2, 3, 4].map((ordinal) => `chapters/${id}/${ordinal}.json`))
    expect(await testRobot(id).storedEventsForTest(before.first.sessionId)).toBe(0)
    expect(listed.map((chapter) => chapter.turns)).toEqual(before.list.map((chapter) => chapter.turns))

    // The chat never notices; search still finds the first chapter.
    expect(strip(await whole(id))).toEqual(before.chat)
    expect((await env.ROBOT.getByName(id).searchConversation('zeppelin')).items.length).toBeGreaterThan(0)
    // The Trajectory of a cold chapter comes from R2, whole and paged.
    expect((await trajectory(id, 1)).events).toEqual(before.first.events)
    const page = (await api<{ events: Array<{ seq: number }> }>(ANNA, `/api/robots/${id}/events?chapter=1&limit=3`)).body
    expect(page.events.map((event) => event.seq)).toEqual(before.first.events.slice(-3).map((event) => event.seq))
    // The Subagent that ran in it aged with it.
    const [child] = (await api<Array<{ id: string }>>(ANNA, `/api/robots/${id}/subagents`)).body
    expect(await testRobot(id).storedEventsForTest(child!.id)).toBe(0)
    const childChat = (await api<{ items: ChatItem[] }>(ANNA, `/api/robots/${id}/subagents/${child!.id}/conversation`)).body.items
    expect(childChat.some((item) => item.kind === 'reply' && item.text.includes('the zeppelin pages'))).toBe(true)
  }, 120_000)

  it('Clear history and deleting the Robot remove the cold chapters (ec-cgsl)', async () => {
    const id = await robot()
    await chapters(id)
    await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)
    expect((await coldKeys(id)).length).toBeGreaterThan(0)
    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'New robot' } })).status).toBe(200)
    expect(await coldKeys(id)).toEqual([])

    await chapters(id)
    await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)
    expect((await coldKeys(id)).length).toBeGreaterThan(0)
    expect((await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })).status).toBe(200)
    expect(await coldKeys(id)).toEqual([])
  }, 180_000)
})
