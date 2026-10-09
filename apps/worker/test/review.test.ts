import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@mr-robot/protocol'
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

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const ITEMS = [
  { id: 'm1', title: 'Reply to Ola', body: 'Thanks, see you Friday.', action: 'Send' },
  { id: 'm2', title: 'Reply to Piotr', body: 'Not this week.' },
  { id: 'm3', title: 'Reply to Kasia', body: 'Yes.' },
]

async function proposeReview(id: string) {
  scripts.set(id, [{ calls: [{ name: 'propose_review', args: { title: 'Replies to send', items: ITEMS } }] }, { text: 'Asked.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'draft the replies' } })
  await settle(id)
  const question = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.findLast((item) => item.kind === 'question')
  if (question?.kind !== 'question') throw new Error('no review question')
  return question.proposal
}

describe('review Ask (v1.6 ticket 06)', () => {
  it('is one Ask with its items; a partial answer wakes the Robot with the approved and rejected ids (cd-dt2x, cd-7gwt)', async () => {
    const id = await activeRobot()
    const proposal = await proposeReview(id)
    expect(proposal).toMatchObject({ kind: 'review', status: 'open', review: { title: 'Replies to send', items: ITEMS } })

    scripts.set(id, [{ text: 'Sending two.' }])
    const answered = await api<{ status: string; review: { decision: unknown } }>(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true, approved: ['m1', 'm3', 'unknown'] } })
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ status: 'approved', review: { decision: { approved: ['m1', 'm3'], rejected: ['m2'] } } })
    await settle(id)
    const wake = JSON.stringify(requests.get(id)!.at(-1))
    expect(wake).toContain('2 approved, 1 rejected')
    expect(wake).toContain('- m1: Reply to Ola')
    expect(wake).toContain('- m3: Reply to Kasia')
    expect(wake).toContain('- m2: Reply to Piotr')
    expect(wake.indexOf('- m1: Reply to Ola')).toBeLessThan(wake.indexOf('Rejected'))
    expect(wake.indexOf('- m2: Reply to Piotr')).toBeGreaterThan(wake.indexOf('Rejected'))

    // The answer is final: a second one is stale, and no new proposal was made.
    const again = await api(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })
    expect(again.status).toBe(409)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'question')
    expect(items).toHaveLength(1)
  })

  it('treats Reject as every item rejected, and approve without ids as every item approved (cd-ueft)', async () => {
    const id = await activeRobot()
    const first = await proposeReview(id)
    scripts.set(id, [{ text: 'Understood.' }])
    const rejected = await api(ANNA, `/api/robots/${id}/proposals/${first.id}`, { body: { revision: first.revision, approve: false } })
    expect(rejected.body).toMatchObject({ status: 'rejected', review: { decision: { approved: [], rejected: ['m1', 'm2', 'm3'] } } })
    await settle(id)

    const second = await proposeReview(id)
    scripts.set(id, [{ text: 'All of them.' }])
    const all = await api(ANNA, `/api/robots/${id}/proposals/${second.id}`, { body: { revision: second.revision, approve: true } })
    expect(all.body).toMatchObject({ status: 'approved', review: { decision: { approved: ['m1', 'm2', 'm3'], rejected: [] } } })
  })
})
