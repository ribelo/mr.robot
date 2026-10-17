import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyGrants, type Me, type MissionView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api<Me>(BEN, '/api/me')
})

async function activeRobot(as: string, name: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, identity: { name, title: '', description: '', avatarColor: '#f4a03a' } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const mission = async (as: string, query = '') => (await api<MissionView>(as, `/api/mission${query}`)).body

describe('Mission Control (v1.13 ticket 06)', () => {
  it('orders the Fleet working first, then waiting for you, then by last activity; Whole Home is the admin\'s (mc-m4dd, mc-m7gg)', async () => {
    const quiet = await activeRobot(ANNA, 'Quiet')
    const waiting = await activeRobot(ANNA, 'Waiting')
    const busy = await activeRobot(ANNA, 'Busy')
    const recent = await activeRobot(ANNA, 'Recent')
    const bens = await activeRobot(BEN, 'Bens')
    await env.ROBOT.getByName(waiting).proposeFromChief('It needs the web', { ...emptyGrants, tools: { web: 'allow' } })
    scripts.set(recent, [{ text: 'Done.' }])
    await api(ANNA, `/api/robots/${recent}/messages`, { body: { text: 'hello' } })
    await settle(recent)
    scripts.set(busy, [{ hang: true }])
    await api(ANNA, `/api/robots/${busy}/messages`, { body: { text: 'work long' } })
    for (let attempt = 0; attempt < 200 && (await mission(ANNA)).fleet[0]?.id !== busy; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))

    const mine = await mission(ANNA)
    const ids = mine.fleet.map((robot) => robot.id)
    expect(ids.slice(0, 2)).toEqual([busy, waiting])
    expect(ids.indexOf(recent)).toBeLessThan(ids.indexOf(quiet))
    expect(ids).not.toContain(bens)
    expect(mine.fleet[0]).toMatchObject({ fleetState: 'working', turn: { wakeup: { kind: 'member', from: 'Anna' }, task: null } })
    expect(mine.counts).toMatchObject({ working: 1, waiting: 1 })
    expect((await mission(ANNA, '?q=rec')).fleet.map((robot) => robot.id)).toEqual([recent])

    expect((await mission(ANNA, '?scope=home')).fleet.map((robot) => robot.id)).toContain(bens)
    expect((await mission(BEN, '?scope=home')).fleet.map((robot) => robot.id)).not.toContain(busy)
    await api(ANNA, `/api/robots/${busy}/interrupt`, { body: {} })
    await settle(busy)
  })

  it('pages the Tasks by 200 with filters (mc-m3cc, mc-m6ff)', async () => {
    for (let index = 0; index < 201; index += 1) await api(ANNA, '/api/tasks', { body: { title: `Task ${String(index).padStart(3, '0')}`, assignee: { kind: 'member', memberId: annaId }, timing: { kind: 'scheduled', at: Date.now() + (index + 1) * 60_000 } } })
    const first = await mission(ANNA)
    expect(first.tasks).toHaveLength(200)
    expect(first.tasksNext).toBe(2)
    expect(first.tasks[0]!.title).toBe('Task 000')
    expect(first.counts.openTasks).toBe(201)
    const second = await mission(ANNA, '?taskPage=2')
    expect(second.tasks.map((task) => task.title)).toEqual(['Task 200'])
    expect(second.tasksNext).toBeNull()
    expect((await mission(ANNA, '?state=done')).tasks).toEqual([])
    expect((await mission(ANNA, '?q=Task%2001')).tasks.map((task) => task.title)).toEqual(['Task 010', 'Task 011', 'Task 012', 'Task 013', 'Task 014', 'Task 015', 'Task 016', 'Task 017', 'Task 018', 'Task 019'])
  })
})
