import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, TaskView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf } from './stub-llm.ts'
import type { Home as TestHome, Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
let annaId = ''
const home = () => env.HOME.getByName('home') as unknown as DurableObjectStub<TestHome>

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function create(body: Record<string, unknown>): Promise<TaskView> {
  const created = await api<TaskView & { error?: string }>(ANNA, '/api/tasks', { body })
  expect(created.body.error).toBeUndefined()
  return created.body
}

/** Task Wake-ups the Robot's model was given. */
async function taskTurns(id: string): Promise<number> {
  return (await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'user/message' && JSON.parse(event.data).source?.kind === 'task').length
}

describe('The Home fires Tasks; the Robot keeps one moment (v1.13 ticket 02)', () => {
  it('a scheduled Task wakes its Robot once with a Task Wake-up (mc-s1aa)', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ say: 'Report sent.' }, { text: 'unexpected second run' }])
    const task = await create({ title: 'Send the report', instructions: 'Mail the weekly report to Anna.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const last = JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))
    expect(last).toContain(`Task \\"Send the report\\" (${task.id}) is due`)
    expect(last).toContain('Mail the weekly report to Anna.')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'task', action: 'ran', taskId: task.id, title: 'Send the report' }),
      expect.objectContaining({ kind: 'reply', text: 'Report sent.' }),
    ])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
    // Only the idle moment after its last Turn is left (v1.14 ticket 09).
    expect(await testRobot(id).alarmForTest()).toBe((await testRobot(id).idlePlanForTest())[0]?.at ?? null)
  })

  it('missed occurrences of a recurring Task collapse into one, and its next moves past now (mc-s2bb)', async () => {
    const id = await activeRobot()
    const task = await create({ title: 'Pulse', instructions: 'Check prices.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } })
    const first = (task.timing as { next: number }).next
    expect(await testRobot(id).alarmForTest()).toBe(first)
    scripts.set(id, [{ text: 'Checked once.' }, { text: 'unexpected second run' }])
    await home().backdateTasksForTest(16 * 60_000)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
    const after = (await api<TaskView>(ANNA, `/api/tasks/${task.id}`)).body
    const next = (after.timing as { next: number }).next
    expect(next).toBeGreaterThan(Date.now())
    // Still on its 5-minute grid, which the downtime moved 16 minutes back.
    expect((next - (first - 16 * 60_000)) % (5 * 60_000)).toBe(0)
    expect(await testRobot(id).alarmForTest()).toBe(next)
  })

  it('a Task assigned to nobody wakes nobody, and assigning it to a Robot plans that Robot (mc-s5ee)', async () => {
    const id = await activeRobot()
    const task = await create({ title: 'Someday', assignee: { kind: 'nobody' }, timing: { kind: 'scheduled', at: Date.now() + 3_600_000 } })
    expect(await testRobot(id).alarmForTest()).toBeNull()
    await api(ANNA, `/api/tasks/${task.id}/assign`, { body: { assignee: { kind: 'robot', robotId: id } } })
    expect(await testRobot(id).alarmForTest()).toBe((task.timing as { at: number }).at)
    await api(ANNA, `/api/tasks/${task.id}/cancel`, { body: {} })
    expect(await testRobot(id).alarmForTest()).toBeNull()
  })

  it('keeps the limits: 50 timed Tasks per Robot and 5 minutes between occurrences (mc-s6ff)', async () => {
    const id = await activeRobot()
    const at = Date.now() + 86_400_000
    for (let index = 0; index < 50; index += 1) await create({ title: `Task ${index}`, assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: at + index } })
    const refused = await api<{ error: string }>(ANNA, '/api/tasks', { body: { title: 'One too many', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at } } })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe('A Robot may have at most 50 scheduled or recurring Tasks. Cancel one before you create another.')
    // An unscheduled Task is not counted.
    await create({ title: 'Whenever', assignee: { kind: 'robot', robotId: id } })
    const cron = await api<{ error: string }>(ANNA, '/api/tasks', { body: { title: 'Every minute', assignee: { kind: 'nobody' }, timing: { kind: 'recurring', schedule: { kind: 'cron', expression: '* * * * *' } } } })
    expect(cron.body.error).toBe('A recurring Task must wait at least 5 minutes (300 seconds) between occurrences. This cron expression occurs more often.')
  })

  it('reminds a person once per occurrence through push, without a Robot (mc-s3cc, mc-s4dd)', async () => {
    const at = Date.now() + 10 * 60_000
    await create({ title: 'Call mum', assignee: { kind: 'member', memberId: annaId }, timing: { kind: 'scheduled', at }, remind: { kind: 'before', minutes: 15 } })
    await runDurableObjectAlarm(home())
    await runDurableObjectAlarm(home())
    const member = env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>
    const reminders = (await member.deliveredForTest()).filter((notification) => notification.kind === 'reminder')
    expect(reminders).toEqual([expect.objectContaining({ kind: 'reminder', title: 'Call mum', url: '/#/mission' })])
  })
})
