import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotGroup, RobotSummary } from '@mr-robot/protocol'
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

async function newRobot(as: string): Promise<string> {
  scripts.set('*', [{ text: 'Hi! What should I do for you?' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

const groups = async (as: string) => (await api<RobotGroup[]>(as, '/api/robot-groups')).body
const entry = async (as: string, id: string) => (await robots(as)).find((robot) => robot.id === id) as RobotSummary
const createGroup = async (as: string, name: string) => (await api<RobotGroup>(as, '/api/robot-groups', { body: { name } })).body
const moveTo = (as: string, id: string, group: { kind: 'ungrouped' } | { kind: 'group'; groupId: string }) => api(as, `/api/robots/${id}/list`, { body: { group } })

describe('sidebar groups (ux-wxbm, ux-o7po, ux-xbvi)', () => {
  it('creates, renames, collapses and reorders groups; a Robot moves in and out; deleting a group ungroups its Robots', async () => {
    const id = await newRobot(ANNA)
    expect(await groups(ANNA)).toEqual([])
    const work = await createGroup(ANNA, '  Work ')
    const space = await createGroup(ANNA, 'Space')
    expect(work).toEqual({ id: expect.any(String), name: 'Work', collapsed: false })
    expect((await groups(ANNA)).map((group) => group.name)).toEqual(['Work', 'Space'])
    expect((await api(ANNA, '/api/robot-groups', { body: { name: '   ' } })).status).toBe(400)

    expect((await api<RobotGroup>(ANNA, `/api/robot-groups/${work.id}`, { method: 'PATCH', body: { name: 'Office', collapsed: true } })).body).toEqual({ id: work.id, name: 'Office', collapsed: true })
    expect((await api<RobotGroup[]>(ANNA, '/api/robot-groups/order', { method: 'PUT', body: { ids: [space.id, work.id] } })).body.map((group) => group.name)).toEqual(['Space', 'Office'])
    expect((await api(ANNA, '/api/robot-groups/order', { method: 'PUT', body: { ids: [space.id] } })).status).toBe(400)
    // Collapsing is remembered: it comes back on the next read.
    expect(await groups(ANNA)).toEqual([{ id: space.id, name: 'Space', collapsed: false }, { id: work.id, name: 'Office', collapsed: true }])

    expect((await entry(ANNA, id)).groupId).toBeUndefined()
    await moveTo(ANNA, id, { kind: 'group', groupId: work.id })
    expect(await entry(ANNA, id)).toMatchObject({ groupId: work.id, pinned: false, hidden: false })
    expect((await moveTo(ANNA, id, { kind: 'group', groupId: 'no-such-group' })).status).toBe(404)
    await moveTo(ANNA, id, { kind: 'ungrouped' })
    expect('groupId' in await entry(ANNA, id)).toBe(false)

    await moveTo(ANNA, id, { kind: 'group', groupId: space.id })
    await api(ANNA, `/api/robots/${id}/list`, { body: { pinned: true } })
    expect((await api(ANNA, `/api/robot-groups/${space.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await groups(ANNA)).map((group) => group.id)).toEqual([work.id])
    const after = await entry(ANNA, id)
    expect('groupId' in after).toBe(false)
    expect(after.pinned).toBe(true)
  })

  it("are the Member's own: another Member sees and changes only theirs (ux-oltg)", async () => {
    const shared = await newRobot(ANNA)
    await api(ANNA, `/api/robots/${shared}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    const annas = await createGroup(ANNA, 'Family')
    await moveTo(ANNA, shared, { kind: 'group', groupId: annas.id })

    expect(await groups(BEN)).toEqual([])
    expect('groupId' in await entry(BEN, shared)).toBe(false)
    expect((await api(BEN, `/api/robot-groups/${annas.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status).toBe(404)
    expect((await api(BEN, `/api/robot-groups/${annas.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await moveTo(BEN, shared, { kind: 'group', groupId: annas.id })).status).toBe(404)

    const bens = await createGroup(BEN, 'Shared with me')
    await moveTo(BEN, shared, { kind: 'group', groupId: bens.id })
    expect((await entry(BEN, shared)).groupId).toBe(bens.id)
    expect((await entry(ANNA, shared)).groupId).toBe(annas.id)
    expect(await groups(ANNA)).toEqual([annas])
  })
})

describe('a Robot that is gone leaves its group (ux-lywk)', () => {
  it('when it is no longer shared: shared again, it comes back ungrouped', async () => {
    const bens = await newRobot(BEN)
    await api(BEN, `/api/robots/${bens}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    const group = await createGroup(ANNA, "Ben's")
    await moveTo(ANNA, bens, { kind: 'group', groupId: group.id })
    expect((await entry(ANNA, bens)).groupId).toBe(group.id)

    await api(BEN, `/api/robots/${bens}/settings`, { method: 'PATCH', body: { sharing: 'private' } })
    expect((await robots(ANNA)).some((robot) => robot.id === bens)).toBe(false)
    await api(BEN, `/api/robots/${bens}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    expect('groupId' in await entry(ANNA, bens)).toBe(false)
    expect(await groups(ANNA)).toEqual([group])
  })

  it('when it is deleted', async () => {
    const id = await newRobot(ANNA)
    const group = await createGroup(ANNA, 'Projects')
    await moveTo(ANNA, id, { kind: 'group', groupId: group.id })
    await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })
    expect((await robots(ANNA)).some((robot) => robot.id === id)).toBe(false)
    const me = (await api<{ id: string }>(ANNA, '/api/me')).body.id
    const stored = await env.MEMBER.getByName(me).listPrefs([id])
    expect(stored[id]).toBeDefined()
    expect(stored[id]!.groupId).toBeUndefined()
  })
})
