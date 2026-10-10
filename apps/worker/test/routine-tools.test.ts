/**
 * One Routine API for every Robot (v1.11 ticket 09, sk-n624, sk-xs60): routine_set, routine_list, routine_pause and
 * routine_delete with an optional robot_id that only Mr. Robot may give. Limits and other-Robot cases are also in
 * deputy.test.ts; DSH's schedule tools being absent is in tool-surface.test.ts.
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Conversation, RobotPanel, RoutineView } from '@mr-robot/protocol'
import { projectChat } from '../src/robot/projection.ts'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me', { headers: { 'X-Time-Zone': 'Europe/Warsaw' } })
})

async function robot(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function chiefId(): Promise<string> {
  const id = (await robots(ANNA)).find((entry) => entry.kind === 'mr-robot')!.id
  await settle(id)
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  return id
}

type Call = { name: string; args: Record<string, unknown> }

/** The Robot's Turn calls these tools in one step; the results come back as the tools returned them. */
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [{ calls: list }, { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-list.length).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
const cards = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'routine' ? [item] : []))

describe('a Robot manages its own Routines (sk-n624)', () => {
  it('creates, lists, edits, pauses, resumes and deletes with the profile zone as the default', async () => {
    const id = await robot(['routines'])
    const [created] = await calls(id, [{ name: 'routine_set', args: { title: 'Digest', prompt: 'Send the digest.', daily: { time: '09:00:00' } } }])
    const routine = JSON.parse(created!) as RoutineView
    expect(routine).toMatchObject({ name: 'Digest', summary: 'Daily at 09:00', timeZone: 'Europe/Warsaw', paused: false, robotId: id })
    expect((await panel(id)).routines).toEqual([routine])

    const [listed, edited, paused, resumed] = await calls(id, [
      { name: 'routine_list', args: {} },
      { name: 'routine_set', args: { id: routine.id, title: 'Morning digest', weekly: { time: '08:00:00', weekdays: [1, 3] } } },
      { name: 'routine_pause', args: { id: routine.id } },
      { name: 'routine_pause', args: { id: routine.id, paused: false } },
    ])
    expect(JSON.parse(listed!)).toEqual([routine])
    expect(JSON.parse(edited!)).toMatchObject({ id: routine.id, name: 'Morning digest', summary: 'Mondays, Wednesdays at 08:00' })
    expect(JSON.parse(paused!)).toMatchObject({ paused: true, nextRun: null })
    expect(JSON.parse(resumed!)).toMatchObject({ paused: false })
    expect(JSON.parse(resumed!).nextRun).toBeGreaterThan(Date.now())

    const [deleted] = await calls(id, [{ name: 'routine_delete', args: { id: routine.id } }])
    expect(JSON.parse(deleted!)).toEqual({ deleted: routine.id, name: 'Morning digest' })
    expect((await panel(id)).routines).toEqual([])
    expect(await testRobot(id).alarmForTest()).toBeNull()
    // The Robot's own changes show as the cards of its tool calls, not as "by <name>" notices.
    expect((await cards(id)).map((card) => [card.action, card.name, card.by])).toEqual([['created', 'Digest', undefined], ['updated', 'Morning digest', undefined], ['deleted', 'Morning digest', undefined]])
  })

  it('refuses a 51st Routine and an interval under 5 minutes in its own words, and keeps nothing', async () => {
    const id = await robot(['routines'])
    const results = await calls(id, [
      { name: 'routine_set', args: { title: 'Fast', prompt: 'Often.', every_seconds: 60 } },
      ...Array.from({ length: 51 }, (_, index) => ({ name: 'routine_set', args: { title: `Once ${index}`, prompt: 'Later.', after_seconds: 3_600 + index } })),
    ])
    expect(results[0]).toContain('5 minutes')
    expect(results[51]).toContain('at most 50')
    expect((await panel(id)).routines).toHaveLength(50)
  })
})

describe('robot_id belongs to Mr. Robot (sk-n624)', () => {
  it('gives a Robot without the chief role a clear error and changes nothing', async () => {
    const worker = await robot(['routines'])
    const other = await robot(['routines'])
    const [made, listed] = await calls(worker, [
      { name: 'routine_set', args: { robot_id: other, title: 'Sneaky', prompt: 'x', after_seconds: 3_600 } },
      { name: 'routine_list', args: { robot_id: other } },
    ])
    expect(made).toContain('only Mr. Robot can use robot_id')
    expect(listed).toContain('only Mr. Robot can use robot_id')
    expect((await panel(other)).routines).toEqual([])
    expect((await panel(worker)).routines).toEqual([])
    // Naming itself is the same as leaving it out.
    const [own] = await calls(worker, [{ name: 'routine_set', args: { robot_id: worker, title: 'Mine', prompt: 'x', after_seconds: 3_600 } }])
    expect(JSON.parse(own!)).toMatchObject({ name: 'Mine' })
  })

  it('lets Mr. Robot work on his own Routines without it and on another Robot\'s with it, through the same tools', async () => {
    const chief = await chiefId()
    const accountant = await robot([])
    const [mine, theirs] = await calls(chief, [
      { name: 'routine_set', args: { title: 'Chief check', prompt: 'Look around.', after_seconds: 3_600 } },
      { name: 'routine_set', args: { robot_id: accountant, title: 'Books', prompt: 'Do the books.', daily: { time: '07:00:00' } } },
    ])
    expect((await panel(chief)).routines.map((routine) => routine.id)).toEqual([(JSON.parse(mine!) as RoutineView).id])
    expect((await panel(accountant)).routines).toEqual([JSON.parse(theirs!)])
    const [ownList, otherList] = (await calls(chief, [{ name: 'routine_list', args: {} }, { name: 'routine_list', args: { robot_id: accountant } }])).map((text) => JSON.parse(text) as RoutineView[])
    expect(ownList!.map((routine) => routine.name)).toEqual(['Chief check'])
    expect(otherList!.map((routine) => routine.name)).toEqual(['Books'])
    // Mr. Robot's Conversation has a card for his own Routine only; the other Robot's shows who made it.
    expect((await cards(chief)).map((card) => [card.action, card.name])).toEqual([['created', 'Chief check']])
    expect((await cards(accountant)).map((card) => [card.action, card.name, card.by])).toEqual([['created', 'Books', 'Mr. Robot']])
  })
})

describe('Conversations stored before the product tools still show their cards (sk-xs60)', () => {
  const at = (seq: number, type: string, data: Record<string, unknown>) => ({ seq, type, time: seq * 1000, data }) as unknown as SessionEvent
  const call = (seq: number, callId: string, name: string, args: Record<string, unknown>, result: Record<string, unknown>) => [
    at(seq, 'tool/call', { callId, name, arguments: JSON.stringify(args) }),
    at(seq + 1, 'tool/result', { message: { id: `m${seq}`, toolCallId: callId, content: [{ type: 'text', text: JSON.stringify(result) }] } }),
  ]

  it('renders schedule_create, schedule_update and schedule_delete as created, updated and deleted', () => {
    const items = projectChat({
      events: [
        ...call(1, 'c1', 'schedule_create', { title: 'Digest', prompt: 'p', daily: { time: '09:00:00' } }, { id: 'schedule-1', title: 'Digest' }),
        ...call(3, 'c2', 'schedule_update', { id: 'schedule-1', title: 'Morning digest' }, { id: 'schedule-1', updated: true, record: { title: 'Morning digest' } }),
        ...call(5, 'c3', 'schedule_delete', { id: 'schedule-1' }, { id: 'schedule-1', deleted: true }),
      ],
      notices: [], proposal: () => undefined,
    })
    expect(items.flatMap((item) => (item.kind === 'routine' ? [[item.action, item.name]] : []))).toEqual([['created', 'Digest'], ['updated', 'Morning digest'], ['deleted', 'Routine']])
  })

  it('renders the new names the same way, and a call about another Robot only as activity', () => {
    const items = projectChat({
      events: [
        ...call(1, 'c1', 'routine_set', { title: 'Digest', prompt: 'p', daily: { time: '09:00:00' } }, { id: 'r1', name: 'Digest' }),
        ...call(3, 'c2', 'routine_set', { id: 'r1', title: 'Morning' }, { id: 'r1', name: 'Morning' }),
        ...call(5, 'c3', 'routine_delete', { id: 'r1' }, { deleted: 'r1', name: 'Morning' }),
        ...call(7, 'c4', 'routine_set', { robot_id: 'robot-2', title: 'Theirs', prompt: 'p', after_seconds: 3600 }, { id: 'r2', name: 'Theirs' }),
        ...call(9, 'c5', 'routine_delete', { robot_id: 'robot-2', id: 'r2' }, { deleted: 'r2' }),
      ],
      notices: [], proposal: () => undefined,
    })
    expect(items.flatMap((item) => (item.kind === 'routine' ? [[item.action, item.name]] : []))).toEqual([['created', 'Digest'], ['updated', 'Morning'], ['deleted', 'Morning']])
  })
})
