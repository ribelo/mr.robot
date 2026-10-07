import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotPanel, RobotSummary, RoutineView } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robotWithRoutines(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['routines'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  scripts.set(body.id, [
    { calls: [{ name: 'schedule_create', args: { title: 'Taxes', prompt: 'Check the tax e-mails.', weekly: { time: '10:59:00', time_zone: 'Europe/Warsaw', weekdays: [1, 2, 3, 4, 5] } } }] },
    { calls: [{ name: 'schedule_create', args: { title: 'Invoices', prompt: 'Send invoices.', daily: { time: '09:00:00', time_zone: 'Europe/Warsaw' } } }] },
    { text: 'Created.' },
  ])
  await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'set up my routines' } })
  await settle(body.id)
  return body.id
}

const routinesOf = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.routines

describe('routine detail (robot-l3gr, robot-qhll)', () => {
  it('shows the schedule in words and as cron with its time zone, and its instructions', async () => {
    const id = await robotWithRoutines()
    const taxes = (await routinesOf(id)).find((routine) => routine.name === 'Taxes')!
    expect(taxes.summary).toBe('Weekdays at 10:59')
    expect(taxes.cron).toBe('CRON_TZ=Europe/Warsaw 59 10 * * 1,2,3,4,5')
    expect(taxes.prompt).toBe('Check the tax e-mails.')
    expect(taxes.paused).toBe(false)
    expect(taxes.nextRun).toBeGreaterThan(Date.now())
  })

  it('pause stops one Routine only; resume plans it again; runs are recorded with their outcome', async () => {
    const id = await robotWithRoutines()
    const [taxes, invoices] = await routinesOf(id) as [RoutineView, RoutineView]
    const paused = (await api<RoutineView>(ANNA, `/api/robots/${id}/routines/${taxes.id}/pause`, { body: { paused: true } })).body
    expect(paused).toMatchObject({ paused: true, nextRun: null })
    expect(await testRobot(id).alarmForTest()).toBe(invoices.nextRun)

    scripts.set(id, [{ text: 'Invoices sent.' }])
    await testRobot(id).backdateRoutinesForTest(1000)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const after = await routinesOf(id)
    expect(after.find((routine) => routine.id === taxes.id)!.runs).toEqual([])
    expect(after.find((routine) => routine.id === invoices.id)!.runs).toEqual([expect.objectContaining({ outcome: 'done', summary: 'Invoices sent.' })])

    const resumed = (await api<RoutineView>(ANNA, `/api/robots/${id}/routines/${taxes.id}/pause`, { body: { paused: false } })).body
    expect(resumed.paused).toBe(false)
    expect(resumed.nextRun).toBeGreaterThan(Date.now())
  })
})

describe('the robot list (robot-mktj, robot-n7th)', () => {
  it('pins, hides and marks unread per person; opening the conversation reads it', async () => {
    const id = await robotWithRoutines()
    const entry = async () => (await robots(ANNA) as Array<RobotSummary>).find((robot) => robot.id === id)!
    await api(ANNA, `/api/robots/${id}/conversation`)
    expect(await entry()).toMatchObject({ unread: false, pinned: false, hidden: false })
    await api(ANNA, `/api/robots/${id}/list`, { body: { pinned: true, hidden: true, unread: true } })
    expect(await entry()).toMatchObject({ unread: true, pinned: true, hidden: true })
    await api(ANNA, `/api/robots/${id}/conversation`)
    expect((await entry()).unread).toBe(false)
    scripts.set(id, [{ text: 'Something new.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'any news?' } })
    await settle(id)
    expect((await entry()).unread).toBe(true)
  })

  it('shows a failed Turn as a blocked state with a plain line, never the raw error', async () => {
    const id = await robotWithRoutines()
    await env.ROBOT.getByName(id).updateSettings({ model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } })
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const entry = (await robots(ANNA) as Array<RobotSummary>).find((robot) => robot.id === id)!
    expect(entry.fleetState).toBe('blocked')
    expect(entry.lastLine).toBe('Could not finish its last task. Open to see why.')
  })
})
