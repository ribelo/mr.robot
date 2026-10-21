/**
 * Auto review (v1.14 ticket 08): a reviewer model checks every call of an item at allow before it runs; a denial
 * becomes an Ask with the reviewer's reason; a failed review fails the call; items at ask keep asking.
 */
import { env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Conversation, ProposalView, RobotPanel } from '@mr-robot/protocol'
import { REVIEW_POLICY } from '../src/agent/auto-review.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const REVIEWER = { provider: 'stub', model: 'stub-reviewer', effort: 'off' } as const
const MODELS = [
  { provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000 },
  { provider: 'stub', model: 'stub-reviewer', label: 'Stub reviewer', contextWindow: 128000, price: { input: 1000, output: 1000 } },
]

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: MODELS } })
})

async function reviewedRobot(files: 'allow' | 'ask' = 'allow'): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, autoReview: true, reviewer: REVIEWER, grants: { tools: { files } } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function file(id: string, path: string): Promise<string | null> {
  const response = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/raw?path=${encodeURIComponent(path)}`, { headers: { 'x-dev-identity': ANNA } })
  return response.status === 404 ? (await response.body?.cancel(), null) : response.text()
}

const asks = async (id: string): Promise<ProposalView[]> => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
  .flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' ? [item.proposal] : []))
const reviewerRequests = (id: string) => (requests.get(id) ?? []).filter((request) => request.system === REVIEW_POLICY)
const pending = (request: GenerateOptions) => JSON.parse(request.messages[0]!.content.map((block) => ('text' in block ? block.text : '')).join('').match(/PENDING_ACTION\n\n([\s\S]*)$/)![1]!) as { name: string; arguments: unknown }
const reviews = async (id: string) => (await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'plugin:mr-robot/review').map((event) => (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as Record<string, unknown>)
const write = (path: string, content: string) => ({ name: 'write', args: { on: 'files', file_path: path, content } })

describe('Auto review (ao-wkpt, ao-gf33, ao-c8k9, ao-6m9i, ao-hfni, ao-jn6z)', () => {
  it('an allowed call runs after the reviewer, on the reviewer route, with the owner\'s words as instructions', async () => {
    const id = await reviewedRobot()
    await say(id, 'save the list', [{ calls: [write('notes/list.md', 'milk')] }, { text: '{"risk":"low","decision":"allow"}' }, { text: 'Saved.' }])
    expect(await file(id, 'notes/list.md')).toBe('milk')
    const [review] = reviewerRequests(id)
    expect(review!.model).toBe('stub-reviewer')
    expect(review!.temperature).toBe(0)
    const text = JSON.stringify(review!.messages)
    for (const section of ['ENVIRONMENT', 'PROJECT_INSTRUCTIONS', 'FILTERED_HISTORY', 'PENDING_ACTION']) expect(text).toContain(section)
    expect(text).toContain('human-instruction')
    expect(pending(review!)).toMatchObject({ name: 'write', arguments: { file_path: 'notes/list.md', content: 'milk' } })
    expect(await reviews(id)).toEqual([expect.objectContaining({ name: 'write', risk: 'low', decision: 'allow', reviewer: 'stub/stub-reviewer' })])
    // The reviewer's tokens are the Robot's review cost.
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage.breakdown.model.review).toBeGreaterThan(0)
  })

  it('a denied call becomes an Ask with the reviewer\'s reason; approved, it runs once', async () => {
    const id = await reviewedRobot()
    await say(id, 'tidy up', [
      { calls: [write('notes/old.md', 'overwritten')] },
      { text: '{"risk":"medium","decision":"deny","reason":"it overwrites a file the owner did not name"}' },
      { text: 'Waiting for you.' },
    ])
    expect(await file(id, 'notes/old.md')).toBeNull()
    const [ask] = await asks(id)
    expect(ask).toMatchObject({ status: 'open', toolCall: { tool: 'write', reason: 'Auto review denied this call: it overwrites a file the owner did not name' } })
    expect(await reviews(id)).toEqual([expect.objectContaining({ decision: 'deny', risk: 'medium', reason: 'it overwrites a file the owner did not name' })])
    // A reviewer's no is never turned into a standing yes by one tap (dp-kcds).
    expect(ask!.toolCall!.alwaysAllow).toBeNull()
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask!.id}/always-allow`, { body: { revision: ask!.revision } })).status).toBe(400)
    scripts.set(id, [{ text: 'Written.' }])
    expect((await api(ANNA, `/api/robots/${id}/proposals/${ask!.id}`, { body: { revision: ask!.revision, approve: true } })).status).toBe(200)
    await settle(id)
    expect(await file(id, 'notes/old.md')).toBe('overwritten')
    // The owner's approval is final: the approved call is not reviewed again.
    expect(reviewerRequests(id)).toHaveLength(1)
  })

  it('a malformed or prose answer fails the call, and the call does not run', async () => {
    const id = await reviewedRobot()
    await say(id, 'save it', [{ calls: [write('notes/a.md', 'x')] }, { text: 'Sure, this looks fine: {"risk":"low","decision":"allow"}' }, { text: 'It failed.' }])
    expect(await file(id, 'notes/a.md')).toBeNull()
    expect(JSON.stringify(requests.get(id)!.at(-1)!.messages)).toContain('Auto review of write failed, so the call did not run')
    expect(await reviews(id)).toEqual([expect.objectContaining({ decision: 'failed' })])
    // A protocol pair that is not allowed is a failure too, never a decision.
    await say(id, 'again', [{ calls: [write('notes/b.md', 'y')] }, { text: '{"risk":"low","decision":"deny"}' }, { text: 'Failed again.' }])
    expect(await file(id, 'notes/b.md')).toBeNull()
    expect(await asks(id)).toEqual([])
  })

  it('an item at ask keeps asking the owner and is not reviewed', async () => {
    const id = await reviewedRobot('ask')
    await say(id, 'save the list', [{ calls: [{ name: 'write', args: { on: 'files', file_path: 'notes/list.md', content: 'milk', reason: 'Keep the list' } }] }, { text: 'Waiting.' }])
    expect(await asks(id)).toEqual([expect.objectContaining({ toolCall: expect.objectContaining({ tool: 'write', reason: 'Keep the list' }) })])
    expect(reviewerRequests(id)).toEqual([])
  })

  it('off by default; the Space default reviewer applies to a Robot without its own', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    expect((await api<RobotPanel>(ANNA, `/api/robots/${body.id}/panel`)).body.settings).toMatchObject({ autoReview: false, reviewer: null, spaceReviewer: null })
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultReviewer: REVIEWER } })
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, autoReview: true, grants: { tools: { files: 'allow' } } } })
    await testRobot(body.id).activateForTest()
    expect((await api<RobotPanel>(ANNA, `/api/robots/${body.id}/panel`)).body.settings).toMatchObject({ autoReview: true, reviewer: null, spaceReviewer: REVIEWER })
    requests.delete(body.id)
    await say(body.id, 'save', [{ calls: [write('notes/c.md', 'z')] }, { text: '{"risk":"low","decision":"allow"}' }, { text: 'Saved.' }])
    expect(reviewerRequests(body.id).map((request) => request.model)).toEqual(['stub-reviewer'])
  })
})
