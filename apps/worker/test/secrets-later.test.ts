/**
 * Secrets outlive a Turn (v1.20.1 ticket 02, cross-review #1): a value the Robot may read, repeated by the model in a later Turn, never reaches
 * the stored events, the stored chat, the search index or a cold chapter; Pages, dreams, spill files and definitions are masked at write.
 * Auto review reads the running Turn only, redacted and bounded (cross-review #2).
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'
import { REVIEW_HISTORY_ITEMS } from '../src/agent/auto-review.ts'

const ANNA = 'anna@example.com'
const PASSWORD = 'hunter2-Very-Secret!'
const DAY = 86_400_000

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robot(settings: Record<string, unknown> = {}): Promise<string> {
  await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['secrets', 'files'], skills: [], recipients: [], secrets: ['allegro'] }, ...settings } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const write = (path: string, content: string) => ({ name: 'write', args: { on: 'workspace', file_path: path, content } })

describe('secrets outlive a Turn (cross-review #1)', () => {
  it('masks a value repeated in a later Turn everywhere it is stored, and in Pages, dreams and definitions', async () => {
    const id = await robot()
    await turn(id, 'log in', [{ calls: [{ name: 'secret_get', args: { name: 'allegro' } }] }, { say: 'Got it.' }])
    // A later Turn: the model repeats the value in its text, a Page, a dream and a note to keep.
    await turn(id, 'remind me', [
      { calls: [write('pages/login.md', `# Login\nThe password is ${PASSWORD}.\n`), write('dreams/2026-10-21.md', `- used ${PASSWORD}\n`)] },
      { say: `The password is ${PASSWORD}.` },
    ])
    expect(await testRobot(id).storedTextForTest()).not.toContain(PASSWORD)
    expect((await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=pages/login.md`)).body.text).toContain('[secret:allegro]')
    expect(await (await env.FILES.get(`robots/${id}/dreams/2026-10-21.md`))!.text()).not.toContain(PASSWORD)
    expect(await (await env.FILES.get(`robots/${id}/pages/login.md`))!.text()).not.toContain(PASSWORD)

    // A cold chapter is uploaded from the stored events: masked too. The chapter with the value, then 31 more, so it ages out.
    await testRobot(id).closeChapterForTest()
    for (let index = 0; index < 31; index += 1) {
      await turn(id, `Message ${index}`, [{ say: `Reply ${index}` }])
      await testRobot(id).closeChapterForTest()
    }
    expect(await testRobot(id).tidyChaptersForTest(Date.now() + 61 * DAY)).toBeGreaterThan(0)
    const listed = await env.FILES.list({ prefix: `chapters/${id}/` })
    expect(listed.objects.length).toBeGreaterThan(0)
    for (const object of listed.objects) expect(await (await env.FILES.get(object.key))!.text()).not.toContain(PASSWORD)

    // A definition saved from the Robot carries no value either.
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: `# MEMORY.md\n- The shop password is ${PASSWORD}.\n` } })
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/definition`, { body: { slug: 'shopper' } })).status).toBe(200)
    const files = await env.FILES.list({ prefix: 'definitions/shopper/' })
    for (const object of files.objects) expect(await (await env.FILES.get(object.key))!.text()).not.toContain(PASSWORD)
  }, 60_000)
})

describe('Auto review sees one Turn, redacted, bounded (cross-review #2)', () => {
  it('sends the reviewer only the running Turn, masked, at most the item limit', async () => {
    const id = await robot({ autoReview: true })
    // An earlier Turn the reviewer must not see.
    await turn(id, 'an earlier Turn about the weather', [{ say: 'Sunny.' }])
    await turn(id, 'log in', [{ calls: [{ name: 'secret_get', args: { name: 'allegro' } }] }, { say: 'Got it.' }])
    // The reviewer runs on the Robot's own stub model: it allows; the Turn writes thirty notes, one per step.
    const steps: StubReply[] = [...Array.from({ length: 30 }, (_, index): StubReply => ({ calls: [write(`notes/${index}.md`, `note ${index} with ${PASSWORD}`)] })), { say: 'Done.' }]
    const reviews = (requests.get(id) ?? []).length
    scripts.set(id, Array.from({ length: 80 }, (): StubReply => (request) => (JSON.stringify(request.messages).includes('FILTERED_HISTORY') ? { text: '{"risk":"low","decision":"allow"}' } : steps.shift() ?? { text: '' })))
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'write the notes' } })
    await settle(id)
    const reviewer = (requests.get(id) ?? []).slice(reviews).filter((request) => JSON.stringify(request.messages).includes('FILTERED_HISTORY'))
    expect(reviewer.length).toBeGreaterThan(20)
    for (const request of reviewer) {
      const text = JSON.stringify(request.messages)
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toContain('an earlier Turn about the weather')
      const body = request.messages.flatMap((message) => message.content.flatMap((block) => ('text' in block ? [block.text] : []))).find((part) => part.includes('FILTERED_HISTORY'))!
      const history = JSON.parse(body.slice(body.indexOf('FILTERED_HISTORY') + 'FILTERED_HISTORY'.length, body.indexOf('PENDING_ACTION')).trim()) as unknown[]
      expect(history.length).toBeLessThanOrEqual(REVIEW_HISTORY_ITEMS)
    }
  }, 120_000)
})