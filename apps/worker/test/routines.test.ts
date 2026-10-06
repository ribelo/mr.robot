import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel } from '@mr-robot/protocol'
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

async function activeRobot(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function weeklyRoutine(id: string): Promise<void> {
  scripts.set(id, [
    { calls: [{ name: 'routine_create', args: { name: 'Overnight outbound', prompt: 'Work the outreach queue.', kind: 'weekly', time: '02:00', weekdays: [7] } }] },
    { calls: [{ name: 'react', args: { emoji: '👍' } }] },
    { text: '' },
  ])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Run this every week.' } })
  await settle(id)
}

describe('Routines on the Durable Object alarm', () => {
  it('a Routine made from chat arms the alarm and shows a card (robot-yrw7, robot-qyd5)', async () => {
    const id = await activeRobot(['routines'])
    await weeklyRoutine(id)
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'message', text: 'Run this every week.', reaction: '👍' }),
      expect.objectContaining({ kind: 'routine', action: 'created', name: 'Overnight outbound' }),
    ])
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.routines).toEqual([expect.objectContaining({ name: 'Overnight outbound', summary: 'Sundays at 02:00', timeZone: 'Europe/Warsaw' })])
    expect(await testRobot(id).alarmForTest()).toBe(panel.routines[0]!.nextRun)
  })

  it('the alarm runs a Turn with the Routine prompt and re-arms (robot-7j1a)', async () => {
    const id = await activeRobot(['routines'])
    await weeklyRoutine(id)
    // The script must be in place before the alarm is armed in the past: workerd may fire it at once.
    scripts.set(id, [{ text: 'Queue worked.' }])
    await testRobot(id).backdateRoutinesForTest(1000)
    // Fire the alarm unless workerd already did.
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const last = requests.get(id)!.at(-1)!
    expect(JSON.stringify(last.messages.at(-1))).toContain('Routine \\"Overnight outbound\\"')
    expect(JSON.stringify(last.messages.at(-1))).toContain('Work the outreach queue.')
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.routines[0]!.nextRun).toBeGreaterThan(Date.now())
    expect(panel.routines[0]!.lastRun).not.toBeNull()
    expect(await testRobot(id).alarmForTest()).toBe(panel.routines[0]!.nextRun)
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'routine', action: 'ran', name: 'Overnight outbound' }),
      expect.objectContaining({ kind: 'reply', text: 'Queue worked.' }),
    ])
  })

  it('three missed occurrences after downtime produce one run (robot-v1gb)', async () => {
    const id = await activeRobot(['routines'])
    scripts.set(id, [
      { calls: [{ name: 'routine_create', args: { name: 'Pulse', prompt: 'Check prices.', kind: 'interval', everyMinutes: 5 } }] },
      { text: 'Created.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'check every 5 minutes' } })
    await settle(id)
    scripts.set(id, [{ text: 'Checked once.' }, { text: 'unexpected second run' }])
    await testRobot(id).backdateRoutinesForTest(16 * 60_000)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const routineRuns = (await env.ROBOT.getByName(id).trajectory())
      .filter((event) => event.type === 'user/message' && JSON.parse(event.data).source?.kind === 'routine')
    expect(routineRuns).toHaveLength(1)
    expect(scripts.get(id)).toEqual([{ text: 'unexpected second run' }])
  })

  it('two Wake-ups arriving together run as two Turns, never interleaved (robot-makt)', async () => {
    const id = await activeRobot([])
    scripts.set(id, [{ text: 'one' }, { text: 'two' }])
    await Promise.all([
      api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'first' } }),
      api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'second' } }),
    ])
    await settle(id)
    const events = await env.ROBOT.getByName(id).trajectory()
    // Each Turn is the span from turn/start to its turn/end; nothing of another Turn falls inside.
    const turns: string[][] = []
    let open: string[] | undefined
    for (const event of events) {
      if (event.type === 'turn/start') {
        expect(open).toBeUndefined()
        open = []
      }
      open?.push(event.type)
      if (event.type === 'turn/end') {
        turns.push(open!)
        open = undefined
      }
    }
    const own = turns.slice(-2)
    expect(own).toHaveLength(2)
    for (const turn of own) {
      expect(turn.filter((type) => type === 'turn/start')).toHaveLength(1)
      expect(turn.at(-1)).toBe('turn/end')
      expect(turn.filter((type) => type === 'user/message')).toHaveLength(1)
    }
  })

  it('deleting the last Routine from the panel clears the alarm', async () => {
    const id = await activeRobot(['routines'])
    await weeklyRoutine(id)
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    const removed = await api(ANNA, `/api/robots/${id}/routines/${panel.routines[0]!.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.routines).toEqual([])
    expect(await testRobot(id).alarmForTest()).toBeNull()
  })
})