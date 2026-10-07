import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, ProposalView, RegistryEntry } from './types.ts'
import { api, robots, settle, stubModels } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function newRobot(as: string, interview: Parameters<typeof scripts.set>[1] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hi! What should I do for you?' }])
  const created = await api<RegistryEntry>(as, '/api/robots', { body: { brief: 'watch apartment prices' } })
  expect(created.status).toBe(200)
  const id = created.body.id
  await settle(id)
  scripts.set(id, [...interview])
  return id
}

async function setupThroughProposal(as: string): Promise<{ id: string; proposal: ProposalView }> {
  const id = await newRobot(as)
  scripts.set(id, [
    { calls: [{ name: 'set_identity', args: { name: 'Flat Watcher', title: 'Housing', description: 'Watches apartment prices.', avatarColor: '#3b82f6' } }] },
    { calls: [{ name: 'setup_complete', args: { purpose: 'Watch listings daily', tools: ['web', 'routines'], skills: [], recipients: [], secrets: [] } }] },
    { text: 'Here is what I need.' },
  ])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'Check Otodom every morning.' } })
  await settle(id)
  const conversation = (await api<Conversation>(as, `/api/robots/${id}/conversation`)).body
  const question = conversation.items.find((item) => item.kind === 'question')
  if (question?.kind !== 'question') throw new Error('no setup question in the conversation')
  return { id, proposal: question.proposal }
}

describe('creating a Robot', () => {
  it('opens its Conversation in setup with the kickoff Turn (robot-btct)', async () => {
    const id = await newRobot(ANNA)
    const list = await robots(ANNA)
    expect(list.find((robot) => robot.id === id)).toMatchObject({ status: 'setup', sharing: 'private' })
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'Hi! What should I do for you?' })
  })

  it('in setup may only ask, propose and write its own persona: no world-facing tools (robot-cobv)', async () => {
    const id = await newRobot(ANNA)
    const tools = await env.ROBOT.getByName(id).toolNames()
    // Plus DSH's read, write and edit from the fs seam over its own Workspace.
    expect(tools.sort()).toEqual(['delete_file', 'glob', 'grep', 'react', 'set_identity', 'setup_complete'])
  })

  it('asks for Grants in one summary; approval is a compare-and-swap that applies exactly that set (robot-cobv)', async () => {
    const { id, proposal } = await setupThroughProposal(ANNA)
    expect(proposal).toMatchObject({ kind: 'setup', status: 'open', grants: { tools: ['web', 'routines'] } })
    expect(proposal.file).toBeNull()

    const stale = await api(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision + 1, approve: true } })
    expect(stale.status).toBe(409)
    expect((await api(BEN, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })).status).toBe(404)

    scripts.set(id, [{ text: 'Thanks, I am on it.' }])
    const approved = await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })
    expect(approved.body.status).toBe('approved')
    await settle(id)
    const robot = (await robots(ANNA)).find((entry) => entry.id === id)
    expect(robot).toMatchObject({ status: 'active', identity: { name: 'Flat Watcher' } })
    const settings = await env.ROBOT.getByName(id).settings()
    expect(settings.grants).toEqual({ tools: ['routines', 'web'], skills: [], recipients: [], secrets: [], hosts: [] })

    const again = await api(ANNA, `/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve: true } })
    expect(again.status).toBe(409)
  })
})

describe('sharing and lifecycle', () => {
  it('keeps a Robot private until shared with the Home (robot-hpj1, robot-bld3)', async () => {
    const id = await newRobot(ANNA)
    expect((await robots(BEN)).some((robot) => robot.id === id)).toBe(false)
    expect((await api(BEN, `/api/robots/${id}/conversation`)).status).toBe(404)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    expect((await robots(BEN)).some((robot) => robot.id === id)).toBe(true)
    expect((await api(BEN, `/api/robots/${id}/conversation`)).status).toBe(200)
    expect((await api(BEN, `/api/robots/${id}/settings`, { method: 'PATCH', body: { sharing: 'private' } })).status).toBe(403)
  })

  it('pause stops Wake-ups, resume runs them, delete keeps the archive (robot-qo06)', async () => {
    const id = await newRobot(ANNA)
    await api(ANNA, `/api/robots/${id}/pause`, { body: {} })
    scripts.set(id, [{ text: 'Back again.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Are you there?' } })
    await settle(id)
    let conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'Hi! What should I do for you?' })
    expect((await robots(ANNA)).find((robot) => robot.id === id)?.fleetState).toBe('paused')

    await api(ANNA, `/api/robots/${id}/resume`, { body: {} })
    await settle(id)
    conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'Back again.' })

    await api(ANNA, `/api/robots/${id}`, { method: 'DELETE' })
    expect((await robots(ANNA)).some((robot) => robot.id === id)).toBe(false)
    expect((await api(ANNA, `/api/robots/${id}/conversation`)).status).toBe(404)
    const archive = await env.ROBOT.getByName(id).trajectory()
    expect(archive.length).toBeGreaterThan(0)
  })

  it("keeps Mr. Robot's recipient Grants in step with what his Member can reach (robot-70kf)", async () => {
    const mrRobot = (await robots(ANNA)).find((robot) => robot.kind === 'mr-robot')!
    const own = await newRobot(ANNA)
    expect((await env.ROBOT.getByName(mrRobot.id).settings()).grants.recipients).toEqual([own])

    const bens = await newRobot(BEN)
    const bensMrRobot = (await robots(BEN)).find((robot) => robot.kind === 'mr-robot')!
    expect((await env.ROBOT.getByName(mrRobot.id).settings()).grants.recipients).toEqual([own])
    await api(BEN, `/api/robots/${bens}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    expect([...(await env.ROBOT.getByName(mrRobot.id).settings()).grants.recipients].sort()).toEqual([own, bens].sort())
    expect((await env.ROBOT.getByName(bensMrRobot.id).settings()).grants.recipients).toEqual([bens])

    await api(ANNA, `/api/robots/${own}`, { method: 'DELETE' })
    expect((await env.ROBOT.getByName(mrRobot.id).settings()).grants.recipients).toEqual([bens])
  })
})