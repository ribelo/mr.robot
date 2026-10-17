import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotSummary, TaskView } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const requestsOf = (id: string) => requests.get(id) ?? []

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
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

/** A scheduled Task of the Robot that is due now; its Turn starts with the alarm. */
async function dueTask(id: string, title: string): Promise<TaskView> {
  const task = (await api<TaskView>(ANNA, '/api/tasks', { body: { title, instructions: 'Do it.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } } })).body
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  return task
}

async function row(id: string): Promise<RobotSummary> {
  return (await robots(ANNA)).find((robot) => robot.id === id)!
}

async function working(id: string): Promise<RobotSummary> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const summary = await row(id)
    if (summary.turn !== null) return summary
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the Turn did not start')
}

const task = async (id: string) => (await api<TaskView>(ANNA, `/api/tasks/${id}`)).body

describe('The Turn knows its cause and subject (v1.13 ticket 03)', () => {
  it('a Task Turn writes an attempt that ends ok, and the Task stays open without task_done (mc-t4dd, mc-w4dd)', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ text: 'Shopping list sent.\nMore detail.' }])
    const shopping = await dueTask(id, 'Shopping')
    await settle(id)
    expect(await task(shopping.id)).toMatchObject({ state: 'open', overdue: false, attempts: [{ robotId: id, outcome: 'ok', firstLine: 'Shopping list sent.' }] })
    expect((await row(id))).toMatchObject({ turn: null, lastWakeup: { wakeup: { kind: 'task', from: 'schedule' }, task: { id: shopping.id, title: 'Shopping' } } })
  })

  it('a failed Turn ends its attempt failed', async () => {
    const id = await activeRobot()
    scripts.set(id, [() => { throw new Error('the model is down') }])
    const report = await dueTask(id, 'Report')
    await settle(id)
    expect((await task(report.id)).attempts).toEqual([expect.objectContaining({ outcome: 'failed', firstLine: 'The Turn failed.' })])
  })

  it('the fleet row shows cause, subject and since; assigning a running Task is refused; interrupt ends it (mc-w1aa, mc-w2bb, mc-n2bb, mc-w5ee)', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ hang: true }])
    const long = await dueTask(id, 'Long job')
    const summary = await working(id)
    expect(summary.fleetState).toBe('working')
    expect(summary.turn).toMatchObject({ wakeup: { kind: 'task', from: 'schedule' }, task: { id: long.id, title: 'Long job' } })
    expect(summary.turn!.since).toBeLessThanOrEqual(Date.now())
    const moved = await api<{ error: string }>(ANNA, `/api/tasks/${long.id}/assign`, { body: { assignee: { kind: 'nobody' } } })
    expect(moved.status).toBe(409)
    expect((await task(long.id)).attempts).toEqual([expect.objectContaining({ outcome: 'running', finishedAt: null })])

    expect((await api(ANNA, `/api/robots/${id}/interrupt`, { body: {} })).status).toBe(200)
    await settle(id)
    expect((await task(long.id)).attempts).toEqual([expect.objectContaining({ outcome: 'interrupted', firstLine: 'Interrupted by Anna.' })])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Interrupted by Anna.' })
    expect(conversation.canRetry).toBe(false)
    expect(await row(id)).toMatchObject({ fleetState: 'sleeping', turn: null })
    expect((await api(ANNA, `/api/robots/${id}/interrupt`, { body: {} })).status).toBe(409)
    expect((await api(ANNA, `/api/tasks/${long.id}/assign`, { body: { assignee: { kind: 'nobody' } } })).status).toBe(200)
  })

  it('a Turn a message started has no Task and writes no attempt', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ hang: true }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Think about it.' } })
    const summary = await working(id)
    expect(summary.turn).toMatchObject({ wakeup: { kind: 'member', from: 'Anna' }, task: null })
    await api(ANNA, `/api/robots/${id}/interrupt`, { body: {} })
    await settle(id)
    expect((await row(id)).lastWakeup).toEqual({ wakeup: { kind: 'member', from: 'Anna' }, task: null })
  })

  it('Run now queues a Task Wake-up naming the person; refused while it waits and for a Task of a person (mc-n1aa, v1.13 ticket 07)', async () => {
    const id = await activeRobot()
    const shopping = (await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Shopping', instructions: 'Buy milk.', assignee: { kind: 'robot', robotId: id } } })).body
    const mine = (await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Mine', assignee: { kind: 'nobody' } } })).body
    await api(ANNA, `/api/robots/${id}/pause`, { body: {} })
    expect((await api(ANNA, `/api/tasks/${shopping.id}/run`, { body: {} })).status).toBe(200)
    expect((await api<{ error: string }>(ANNA, `/api/tasks/${shopping.id}/run`, { body: {} })).body.error).toBe('This Task already waits for its Robot.')
    expect((await api<{ error: string }>(ANNA, `/api/tasks/${mine.id}/run`, { body: {} })).body.error).toBe('Only a Task of a Robot can be run now.')
    scripts.set(id, [{ hang: true }])
    await api(ANNA, `/api/robots/${id}/resume`, { body: {} })
    const summary = await working(id)
    expect(summary.turn).toMatchObject({ wakeup: { kind: 'task', from: 'Anna' }, task: { id: shopping.id, title: 'Shopping' } })
    expect(JSON.stringify(requestsOf(id).at(-1)!.messages.at(-1))).toContain(`Task \\"Shopping\\" (${shopping.id}): Anna asked you to run it now.`)
    expect((await api(ANNA, `/api/tasks/${shopping.id}/run`, { body: {} })).status).toBe(409)
    await api(ANNA, `/api/robots/${id}/interrupt`, { body: {} })
    await settle(id)
  })
})
