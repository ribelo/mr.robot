import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminView, Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: [{ provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000, price: { input: 1, output: 10 } }] } })
})

async function robotOf(as: string, tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const admin = async () => (await api<AdminView>(ANNA, '/api/admin')).body

describe('the admin view', () => {
  it('shows every Robot with its live state, Grants and model (robot-x26m)', async () => {
    await api(ANNA, '/api/admin/members', { body: { email: BEN } })
    await api(BEN, '/api/me')
    const anna = await robotOf(ANNA, ['web'])
    const ben = await robotOf(BEN)
    await api(BEN, `/api/robots/${ben}/pause`, { body: {} })
    const view = await admin()
    const row = (id: string) => view.fleet.find((entry) => entry.id === id)!
    expect(row(anna)).toMatchObject({ fleetState: 'sleeping', grants: { tools: { web: 'allow' } }, model: { provider: 'stub' }, ownerName: 'Anna' })
    expect(row(ben)).toMatchObject({ fleetState: 'paused', ownerName: 'Ben' })
    expect(view.fleet.filter((entry) => entry.kind === 'mr-robot')).toHaveLength(2)
    expect((await api(BEN, '/api/admin')).status).toBe(403)
  })

  it('cost table matches the Member and Robot counters', async () => {
    const id = await robotOf(ANNA)
    scripts.set(id, [{ text: 'one' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const view = await admin()
    const me = (await api<Me>(ANNA, '/api/me')).body
    const member = view.members.find((entry) => entry.id === me.id)!
    const robots = view.fleet.filter((entry) => entry.ownerId === me.id)
    expect(member.usage.costUsd).toBeCloseTo(robots.reduce((sum, entry) => sum + entry.usage.costUsd, 0), 10)
    expect(member.usage.costUsd).toBeGreaterThan(0)
  })
})
