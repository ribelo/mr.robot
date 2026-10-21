import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminView, Conversation, Me, TaskPage } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf } from './stub-llm.ts'
import type { Space as TestSpace } from './worker.ts'

const ANNA = 'anna@example.com'
const HOUR = 3_600_000
const space = () => env.SPACE.getByName('space') as unknown as DurableObjectStub<TestSpace>

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api<Me>(ANNA, '/api/me')
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

describe('Routines become Tasks (v1.13 ticket 05)', () => {
  it('moves a Robot\'s Routines with their runs to Tasks once; old cards and Wake-ups read as Tasks (mc-t7gg, mc-c2bb)', async () => {
    const id = await activeRobot()
    const next = Date.now() + HOUR
    const ran = Date.now() - 2 * HOUR
    await testRobot(id).seedRoutinesForTest([
      { id: 'schedule-1', name: 'Digest', prompt: 'Send the digest.', record: { kind: 'daily', title: 'Digest', prompt: 'Send the digest.', scheduledAt: new Date(next).toISOString(), time: '09:00:00', timeZone: 'Europe/Warsaw' }, nextRun: next,
        runs: [{ startedAt: ran - HOUR, outcome: 'failed', firstLine: 'The Turn failed.' }, { startedAt: ran, outcome: 'ok', firstLine: 'Digest sent.' }] },
      { id: 'schedule-2', name: 'Once', prompt: 'Book the table.', record: { kind: 'at', title: 'Once', prompt: 'Book the table.', scheduledAt: new Date(ran).toISOString() }, nextRun: null, runs: [{ startedAt: ran, outcome: 'ok', firstLine: 'Booked.' }] },
      { id: 'schedule-3', name: 'Paused pulse', prompt: 'Check prices.', record: { kind: 'every', title: 'Paused pulse', prompt: 'Check prices.', scheduledAt: new Date(next).toISOString(), everySeconds: 600 }, nextRun: null, paused: true, runs: [] },
    ])
    await space().unmigrateForTest(id)
    expect((await api<AdminView>(ANNA, '/api/admin')).body.robotsToMigrate).toBe(1)

    await space().migrateRoutines()
    expect((await api<AdminView>(ANNA, '/api/admin')).body.robotsToMigrate).toBe(0)
    expect(await testRobot(id).hasRoutineTablesForTest()).toBe(false)
    const tasks = (await api<TaskPage>(ANNA, `/api/tasks?assignee=robot:${id}&state=all`)).body.tasks
    const byId = Object.fromEntries(tasks.map((task) => [task.id, task]))
    expect(byId['schedule-1']).toMatchObject({
      title: 'Digest', instructions: 'Send the digest.', state: 'open', createdBy: { kind: 'robot', robotId: id },
      timing: { kind: 'recurring', schedule: { kind: 'daily', time: '09:00' }, timeZone: 'Europe/Warsaw', next, paused: false },
      attempts: [{ robotId: id, outcome: 'ok', firstLine: 'Digest sent.' }, { robotId: id, outcome: 'failed', firstLine: 'The Turn failed.' }],
    })
    expect(byId['schedule-2']).toMatchObject({ state: 'done', timing: { kind: 'scheduled', at: Date.parse(new Date(ran).toISOString()) }, attempts: [expect.objectContaining({ outcome: 'ok' })] })
    expect(byId['schedule-3']).toMatchObject({ state: 'open', timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 10 }, paused: true } })
    // The Robot keeps the moment of its earliest due Task: the Digest's, as when it was a Routine.
    expect(await testRobot(id).alarmForTest()).toBe(next)

    // A stored Routine card reads as a Task card; a queued Routine Wake-up runs as its Task's.
    await testRobot(id).seedRoutineItemsForTest('schedule-1', 'Digest')
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'task', action: 'created', title: 'Digest', by: 'Mr. Robot' })]))
    scripts.set(id, [{ say: 'Digest sent again.' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))).toContain('Task \\"Digest\\" (schedule-1) is due')
    expect((await api<TaskPage>(ANNA, `/api/tasks?assignee=robot:${id}&state=all`)).body.tasks.find((task) => task.id === 'schedule-1')!.attempts[0]).toMatchObject({ outcome: 'ok', firstLine: 'Digest sent again.' })

    // Migrating again changes nothing.
    await space().unmigrateForTest(id)
    await space().migrateRoutines()
    expect((await api<TaskPage>(ANNA, `/api/tasks?assignee=robot:${id}&state=all`)).body.tasks).toHaveLength(3)
  })
})
