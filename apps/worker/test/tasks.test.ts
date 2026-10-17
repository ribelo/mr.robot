import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, TaskPage, TaskView } from '@mr-robot/protocol'
import { api, settle, stubModels } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const HOUR = 3_600_000
let annaId = ''
let benId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  benId = (await api<Me>(BEN, '/api/me')).body.id
})

async function create(as: string, body: Record<string, unknown>): Promise<TaskView> {
  const created = await api<TaskView>(as, '/api/tasks', { body })
  expect(created.status).toBe(200)
  return created.body
}

async function newRobot(as: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

const listed = async (as: string, query = '') => (await api<TaskPage>(as, `/api/tasks${query}`)).body.tasks.map((task) => task.title)

describe('Tasks at the Home (v1.13 ticket 01)', () => {
  it('round-trips a Task through create, edit, pause, done and cancel (mc-t1aa, mc-t2bb, mc-t3cc)', async () => {
    const at = Date.now() + HOUR
    const call = await create(ANNA, { title: ' Call mum ', instructions: 'Ask about Sunday.', assignee: { kind: 'member', memberId: annaId }, timing: { kind: 'scheduled', at, deadline: at + HOUR }, remind: { kind: 'before', minutes: 15 } })
    expect(call).toMatchObject({ title: 'Call mum', state: 'open', timing: { kind: 'scheduled', at, deadline: at + HOUR }, remind: { kind: 'before', minutes: 15 }, createdBy: { kind: 'member', memberId: annaId }, children: 0, overdue: false, attempts: [] })

    const edited = await api<TaskView>(ANNA, `/api/tasks/${call.id}`, { method: 'PATCH', body: { title: 'Call mum and dad' } })
    expect(edited.body).toMatchObject({ title: 'Call mum and dad', timing: { kind: 'scheduled', at } })

    const child = await create(ANNA, { title: 'Buy flowers', assignee: { kind: 'nobody' }, parentId: call.id })
    expect(child.parentId).toBe(call.id)
    expect((await api<TaskView>(ANNA, `/api/tasks/${call.id}`)).body.children).toBe(1)
    expect(await listed(ANNA, `?parent=${call.id}`)).toEqual(['Buy flowers'])

    const weekly = await create(ANNA, { title: 'Water the plants', assignee: { kind: 'member', memberId: annaId }, timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [6] }, timeZone: 'Europe/Warsaw' } })
    expect(weekly.timing).toMatchObject({ kind: 'recurring', paused: false, timeZone: 'Europe/Warsaw' })
    const first = (weekly.timing as { next: number }).next
    expect(first).toBeGreaterThan(Date.now())
    expect((await api<TaskView>(ANNA, `/api/tasks/${weekly.id}/pause`, { body: { paused: true } })).body.timing).toMatchObject({ paused: true })
    // An edit that sends the same rule again keeps the pause and the next occurrence (mc-t3cc).
    const resent = await api<TaskView>(ANNA, `/api/tasks/${weekly.id}`, { method: 'PATCH', body: { title: 'Water the plants', timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [6] }, timeZone: 'Europe/Warsaw' } } })
    expect(resent.body.timing).toMatchObject({ paused: true, next: first })
    expect((await api<TaskView>(ANNA, `/api/tasks/${weekly.id}/pause`, { body: { paused: false } })).body.timing).toMatchObject({ paused: false, next: first })
    // Done on a recurring Task handles one occurrence; the Task stays open with the next one (mc-s2bb).
    const handled = (await api<TaskView>(ANNA, `/api/tasks/${weekly.id}/done`, { body: {} })).body
    expect(handled.state).toBe('open')
    const next = (handled.timing as { next: number }).next
    // The next Saturday at 09:00 in Warsaw, a week on (a clock change may lie between).
    expect(Math.abs(next - first - 7 * 24 * HOUR)).toBeLessThanOrEqual(HOUR)
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(next)).toBe('Saturday 09:00')

    expect((await api<TaskView>(ANNA, `/api/tasks/${call.id}/done`, { body: {} })).body.state).toBe('done')
    expect((await api(ANNA, `/api/tasks/${call.id}/done`, { body: {} })).status).toBe(409)
    expect((await api<TaskView>(ANNA, `/api/tasks/${child.id}/cancel`, { body: {} })).body.state).toBe('cancelled')

    expect(await listed(ANNA)).toEqual(['Water the plants'])
    expect(await listed(ANNA, '?state=done')).toEqual(['Call mum and dad'])
    expect((await listed(ANNA, '?state=all')).sort()).toEqual(['Buy flowers', 'Call mum and dad', 'Water the plants'])
    expect(await listed(ANNA, '?state=all&q=plant')).toEqual(['Water the plants'])
  })

  it('refuses a deadline before the start, a deadline on a recurring Task and a pause of a Task that does not recur', async () => {
    const at = Date.now() + HOUR
    const early = await api<{ error: string }>(ANNA, '/api/tasks', { body: { title: 'Early', assignee: { kind: 'nobody' }, timing: { kind: 'scheduled', at, deadline: at - 1 } } })
    expect(early.status).toBe(400)
    expect(early.body.error).toContain('deadline is before the start')
    const recurring = await api<{ error: string }>(ANNA, '/api/tasks', { body: { title: 'Daily', assignee: { kind: 'nobody' }, timing: { kind: 'recurring', schedule: { kind: 'daily', time: '08:00' }, deadline: at } } })
    expect(recurring.status).toBe(400)
    expect(recurring.body.error).toContain('A recurring Task has no deadline')
    const often = await api<{ error: string }>(ANNA, '/api/tasks', { body: { title: 'Often', assignee: { kind: 'nobody' }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 2 } } } })
    expect(often.body.error).toContain('at least 5 minutes')
    const once = await create(ANNA, { title: 'Once', assignee: { kind: 'nobody' }, timing: { kind: 'scheduled', at } })
    const pause = await api<{ error: string }>(ANNA, `/api/tasks/${once.id}/pause`, { body: { paused: true } })
    expect(pause.status).toBe(400)
    expect(pause.body.error).toBe('Only a recurring Task can be paused.')
  })

  it('shows a Member only the Tasks he may see; Whole Home shows the admin all (mc-r2bb, mc-m7gg)', async () => {
    const annasRobot = await newRobot(ANNA)
    const shared = await newRobot(ANNA)
    await api(ANNA, `/api/robots/${shared}/settings`, { method: 'PATCH', body: { sharing: 'home' } })
    await create(ANNA, { title: 'Anna alone', assignee: { kind: 'nobody' } })
    await create(ANNA, { title: 'For the private Robot', assignee: { kind: 'robot', robotId: annasRobot } })
    await create(ANNA, { title: 'For the shared Robot', assignee: { kind: 'robot', robotId: shared } })
    const forBen = await create(ANNA, { title: 'For Ben', assignee: { kind: 'member', memberId: benId } })
    const bens = await create(BEN, { title: 'Ben alone', assignee: { kind: 'member', memberId: benId } })

    expect((await listed(BEN)).sort()).toEqual(['Ben alone', 'For Ben', 'For the shared Robot'])
    expect((await listed(ANNA)).sort()).toEqual(['Anna alone', 'For Ben', 'For the private Robot', 'For the shared Robot'])
    expect((await listed(ANNA, '?scope=home')).length).toBe(5)
    // One Task's routes follow the admin's remembered Whole Home switch (mc-m7gg).
    expect((await api(ANNA, `/api/tasks/${bens.id}`)).status).toBe(404)
    await api(ANNA, '/api/me', { method: 'PATCH', body: { mission: { wholeHome: true } } })
    expect((await api(ANNA, `/api/tasks/${bens.id}`)).status).toBe(200)
    // Whole Home is the admin's alone; for Ben it is his own view.
    expect((await listed(BEN, '?scope=home')).length).toBe(3)
    expect((await api(BEN, `/api/tasks/${forBen.id}`)).status).toBe(200)
    expect((await api(BEN, `/api/tasks/${(await create(ANNA, { title: 'Hidden', assignee: { kind: 'robot', robotId: annasRobot } })).id}`)).status).toBe(404)
    // Ben cannot give a Task to a Robot he does not reach.
    const refused = await api<{ error: string }>(BEN, `/api/tasks/${bens.id}/assign`, { body: { assignee: { kind: 'robot', robotId: annasRobot } } })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('You cannot reach that Robot.')
    expect((await api<TaskView>(BEN, `/api/tasks/${bens.id}/assign`, { body: { assignee: { kind: 'robot', robotId: shared } } })).body.assignee).toEqual({ kind: 'robot', robotId: shared })
  })

  it('leaves the open Tasks of a deleted Robot and a removed Member unassigned (mc-t8hh)', async () => {
    const id = await newRobot(ANNA)
    const robots = await create(ANNA, { title: 'Robot work', assignee: { kind: 'robot', robotId: id } })
    const bens = await create(ANNA, { title: 'Ben work', assignee: { kind: 'member', memberId: benId }, remind: { kind: 'before', minutes: 5 } })
    expect((await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })).status).toBe(200)
    expect((await api(ANNA, `/api/admin/members/${benId}`, { method: 'DELETE' })).status).toBe(200)
    expect((await api<TaskView>(ANNA, `/api/tasks/${robots.id}`)).body).toMatchObject({ assignee: { kind: 'nobody' }, state: 'open' })
    expect((await api<TaskView>(ANNA, `/api/tasks/${bens.id}`)).body).toMatchObject({ assignee: { kind: 'nobody' }, state: 'open', remind: { kind: 'none' } })
  })
})
