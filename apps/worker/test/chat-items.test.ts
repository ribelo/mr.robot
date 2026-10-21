/**
 * The stored chat (v1.19 ticket 03): items are written with the events they come from; the chat is read a page at a time by a cursor
 * that crosses chapters; a Robot from before v1.19 is folded over several Turns and reads the same meanwhile. The Fleet's running tool,
 * read from the tail of the live chapter, is tested with the Box (box.test.ts).
 */
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem, Conversation } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'
import { chatBackfill } from './worker.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})
afterEach(() => {
  chatBackfill.events = undefined
})

async function robot(tools: Record<string, string> = { files: 'allow', tasks: 'allow' }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** A few Turns of every kind the chat shows: messages, replies, a reaction, a tool's activity, a Task card. */
async function history(id: string, turns: number): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await turn(id, `Message ${index}`, index % 3 === 0
      ? [{ calls: [{ name: 'react', args: { emoji: '👍' } }, { name: 'glob', args: { on: 'files', pattern: '*.md' } }] }, { say: `Reply ${index}` }]
      : index % 3 === 1 ? [{ calls: [{ name: 'task_create', args: { title: `Task ${index}`, instructions: 'Do it.', assignee: 'self', timing: { kind: 'unscheduled' } } }] }, { say: `Reply ${index}` }]
        : [{ say: `Reply ${index}` }])
  }
}

/** A context past its budget; the platform's step after the Turn compacts it and the chapter closes. */
async function compact(id: string): Promise<void> {
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { contextBudget: 8000 } })
  await turn(id, 'a long one', [{ text: 'Apartment on Mokotowska, 1 200 000 PLN. '.repeat(700), inputTokens: 7900 }])
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { contextBudget: 128_000 } })
}

const whole = async (id: string, details = false) => (await testRobot(id).conversationView(details)).items
const page = async (id: string, before?: string, details = false) =>
  (await api<Conversation>(ANNA, `/api/robots/${id}/conversation?details=${details ? 1 : 0}${before === undefined ? '' : `&before=${encodeURIComponent(before)}`}`)).body
const strip = (items: readonly ChatItem[]) => items.map((item) => JSON.stringify(item))

describe('the chat is stored with the events (ec-2sra)', () => {
  it('stores what the log shows, at every level of work details, the same as folding the log', async () => {
    const id = await robot()
    await history(id, 6)
    const stored = { compact: await whole(id), details: await whole(id, true) }
    expect(stored.compact.filter((item) => item.kind === 'message').map((item) => item.kind === 'message' && [item.text, item.reaction])).toEqual([
      ['Message 0', '👍'], ['Message 1', null], ['Message 2', null], ['Message 3', '👍'], ['Message 4', null], ['Message 5', null],
    ])
    expect(stored.compact.some((item) => item.kind === 'task' && item.title === 'Task 1')).toBe(true)
    expect(stored.details.some((item) => item.kind === 'activity' && item.calls?.some((call) => call.name === 'glob'))).toBe(true)
    await testRobot(id).unstoreChatForTest()
    expect(strip(await whole(id))).toEqual(strip(stored.compact))
    expect(strip(await whole(id, true))).toEqual(strip(stored.details))
  })
})

describe('the chat a page at a time, across chapters (ec-n0uh, ec-yxru, ec-enqy)', () => {
  it('pages back by the cursor from the newest item to the first, crossing a chapter boundary unnoticed', async () => {
    const id = await robot()
    await history(id, 20)
    await compact(id)
    await history(id, 20)
    expect((await testRobot(id).chaptersForTest()).length).toBeGreaterThanOrEqual(2)
    const pages: Conversation[] = [await page(id)]
    while (pages.at(-1)!.before !== null) pages.push(await page(id, pages.at(-1)!.before!))
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]!.items.length).toBe(50)
    const read = pages.reverse().flatMap((entry) => entry.items)
    expect(strip(read)).toEqual(strip(await whole(id)))
    const texts = read.flatMap((item) => (item.kind === 'message' ? [item.text] : []))
    expect(texts.filter((text) => text === 'Message 0')).toHaveLength(2)
    expect(new Set(read.map((item) => item.id)).size).toBe(read.length)
    // Search reaches the first chapter too.
    expect((await env.ROBOT.getByName(id).searchConversation('Mokotowska')).items.length).toBeGreaterThan(0)
    expect((await page(id, 'not-a-cursor' as string))).toMatchObject({ error: expect.any(String) })
    // 41 Turns: slow when the whole suite shares the machine.
  }, 120_000)

  it('names every open Ask with each page, wherever it is', async () => {
    const id = await robot()
    await turn(id, 'ask me', [{ calls: [{ name: 'ask', args: { prompt: 'Red or blue?', options: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] } }] }, { say: 'Asked.' }])
    await history(id, 30)
    const newest = await page(id)
    expect(newest.items.some((item) => item.kind === 'proposal')).toBe(false)
    expect(newest.asks?.map((ask) => ask.purpose)).toEqual([expect.stringContaining('Red or blue?')])
  })
})

describe('a Robot from before v1.19 (ec-2sra)', () => {
  it('reads the same while its chat is folded a bounded part per Turn, over several Turns', async () => {
    const id = await robot()
    await history(id, 8)
    const before = strip(await whole(id))
    await testRobot(id).unstoreChatForTest()
    expect(await testRobot(id).chatBehindForTest()).toBe(1)
    expect(strip(await whole(id))).toEqual(before)
    chatBackfill.events = 40
    let turns = 0
    while ((await testRobot(id).chatBehindForTest()) > 0 && turns < 20) {
      await turn(id, `Later ${turns}`, [{ say: `Later reply ${turns}` }])
      turns += 1
      expect(strip(await whole(id)).slice(0, before.length)).toEqual(before)
    }
    expect(turns).toBeGreaterThan(1)
    expect(await testRobot(id).chatBehindForTest()).toBe(0)
    const after = await whole(id)
    expect(strip(after).slice(0, before.length)).toEqual(before)
    expect(after.filter((item) => item.kind === 'reply' && item.text.startsWith('Later reply'))).toHaveLength(turns)
  }, 60_000)
})
