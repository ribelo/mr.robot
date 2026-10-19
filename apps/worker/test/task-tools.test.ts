/**
 * The Task tools of every Robot (v1.13 ticket 04, mc-r1aa…mc-r4dd): what task_list shows, whom a Robot gives Tasks,
 * task_focus and task_done in a Turn, robot_id for Mr. Robot only; and Conversations stored with the Routine tools
 * before still show their cards as Task cards (mc-c2bb).
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Conversation, Me, TaskPage, TaskView } from '@mr-robot/protocol'
import { projectChat } from '../src/robot/projection.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
let annaId = ''
let benId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me', { headers: { 'X-Time-Zone': 'Europe/Warsaw' } })).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  benId = (await api<Me>(BEN, '/api/me')).body.id
})

async function robot(as: string, tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }

/** The Robot's Turn calls these tools in one step; the results come back as the tools returned them. */
async function calls(id: string, list: Call[], as = ANNA): Promise<string[]> {
  scripts.set(id, [{ calls: list }, { text: 'Done.' }])
  await api(as, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-list.length).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

const create = async (as: string, body: Record<string, unknown>) => (await api<TaskView>(as, '/api/tasks', { body })).body

describe('a Robot works with Tasks through the tools (v1.13 ticket 04)', () => {
  it('task_list shows what its owner sees, and nothing of another Member (mc-r2bb)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const other = await robot(ANNA, [])
    await create(ANNA, { title: 'Anna buys milk', assignee: { kind: 'member', memberId: annaId } })
    await create(ANNA, { title: 'For this Robot', assignee: { kind: 'robot', robotId: id } })
    await create(ANNA, { title: 'For the other Robot', assignee: { kind: 'robot', robotId: other } })
    await create(ANNA, { title: 'Nobody yet', assignee: { kind: 'nobody' } })
    await create(BEN, { title: 'Ben alone', assignee: { kind: 'member', memberId: benId } })
    const [all, own] = await calls(id, [{ name: 'task_list', args: {} }, { name: 'task_list', args: { assignee: 'self' } }])
    const listed = JSON.parse(all!) as { time_zone: string; tasks: Array<{ title: string; assignee: string }> }
    expect(listed.time_zone).toBe('Europe/Warsaw')
    expect(listed.tasks.map((task) => task.title).sort()).toEqual(['Anna buys milk', 'For the other Robot', 'For this Robot', 'Nobody yet'])
    expect(listed.tasks.find((task) => task.title === 'Anna buys milk')!.assignee).toBe('owner (Anna)')
    expect((JSON.parse(own!) as { tasks: Array<{ title: string; assignee: string }> }).tasks).toEqual([expect.objectContaining({ title: 'For this Robot', assignee: 'self' })])
  })

  it('creates a Task for its owner with a moment and a reminder, shown as a card; refuses another Member who does not accept its Tasks (mc-r3cc, mc-a2bb)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const [made, refused, robotRefused] = await calls(id, [
      { name: 'task_create', args: { title: 'Call the dentist', instructions: 'Book a check-up.', assignee: 'owner', timing: { kind: 'scheduled', at: '2030-01-15T10:00' }, remind_minutes: 30 } },
      { name: 'task_create', args: { title: 'Ben, sign this', assignee: 'member:Ben' } },
      { name: 'task_create', args: { title: 'Not mine', assignee: 'robot:mr-robot-' + benId } },
    ])
    const task = JSON.parse(made!) as { id: string; assignee: string; timing: { at: string }; remind_minutes: number }
    expect(task).toMatchObject({ assignee: 'owner (Anna)', timing: { kind: 'scheduled', at: '2030-01-15 10:00' }, remind_minutes: 30 })
    const stored = (await api<TaskView>(ANNA, `/api/tasks/${task.id}`)).body
    expect(stored).toMatchObject({ assignee: { kind: 'member', memberId: annaId }, timing: { kind: 'scheduled', at: Date.parse('2030-01-15T09:00:00Z') }, remind: { kind: 'before', minutes: 30 }, createdBy: { kind: 'robot', robotId: id } })
    expect(refused).toContain('Ben does not accept Tasks from the Robots of Anna')
    expect(refused).toContain('Accept tasks from the Robots of…')
    expect(robotRefused).toContain("only to its owner, its owner's Robots and itself")
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.filter((item) => item.kind === 'task')).toEqual([expect.objectContaining({ action: 'created', taskId: task.id, title: 'Call the dentist' })])
  })

  it('gives another Member a Task once that Member accepts Tasks from its owner\'s Robots (mc-a1aa, mc-a2bb)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const ask = async () => (await calls(id, [{ name: 'task_create', args: { title: 'Sign the lease', assignee: 'member:ben@example.com' } }]))[0]!
    expect(await ask()).toContain('Accept tasks from the Robots of…')
    // Only real Members other than Ben himself can be named; an unknown id is dropped.
    expect((await api(BEN, '/api/me', { method: 'PATCH', body: { acceptTasksFrom: [annaId, benId, 'm-nobody'] } })).status).toBe(200)
    expect((await api<Me>(BEN, '/api/me')).body.acceptTasksFrom).toEqual([annaId])
    const made = JSON.parse(await ask()) as { id: string; assignee: string }
    expect(made.assignee).toBe('member:Ben')
    expect((await api<TaskView>(BEN, `/api/tasks/${made.id}`)).body).toMatchObject({ title: 'Sign the lease', assignee: { kind: 'member', memberId: benId } })
    await api(BEN, '/api/me', { method: 'PATCH', body: { acceptTasksFrom: [] } })
    expect(await ask()).toContain('does not accept Tasks from the Robots of Anna')
  })

  it('task_focus makes a message Turn work on a Task; task_done finishes it with its line (mc-w3cc, mc-w4dd)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const shopping = await create(ANNA, { title: 'Shopping', assignee: { kind: 'robot', robotId: id } })
    const elsewhere = await create(ANNA, { title: 'Someone else', assignee: { kind: 'nobody' } })
    const [notMine, focused, again, done] = await calls(id, [
      { name: 'task_focus', args: { task_id: elsewhere.id, reason: 'Anna asked' } },
      { name: 'task_focus', args: { task_id: shopping.id, reason: 'Anna asked for the shopping now' } },
      { name: 'task_focus', args: { task_id: shopping.id, reason: 'still the shopping' } },
      { name: 'task_done', args: { task_id: shopping.id, first_line: 'Bought everything.' } },
    ])
    expect(notMine).toContain('not an open Task assigned to you')
    expect(JSON.parse(focused!)).toEqual({ focused: shopping.id, title: 'Shopping' })
    // Focusing the Task the Turn already works on changes nothing.
    expect(JSON.parse(again!)).toEqual({ focused: shopping.id, title: 'Shopping' })
    expect(JSON.parse(done!)).toMatchObject({ id: shopping.id, state: 'done' })
    const after = (await api<TaskView>(ANNA, `/api/tasks/${shopping.id}`)).body
    expect(after).toMatchObject({ state: 'done', attempts: [{ robotId: id, outcome: 'ok', firstLine: 'Bought everything.' }] })
  })

  it('focus changes in a Turn: the Task left ends skipped with the reason, the new one runs, the fleet row follows (ao-lj6z, ao-cvpx)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const report = await create(ANNA, { title: 'Report', assignee: { kind: 'robot', robotId: id } })
    const invoice = await create(ANNA, { title: 'Invoice', assignee: { kind: 'robot', robotId: id } })
    const taskCell = async () => (await api<Array<{ id: string; turn: { task: { id: string } | null } | null }>>(ANNA, '/api/robots')).body.find((row) => row.id === id)!.turn?.task?.id ?? null
    const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve }); return { promise, open } }
    const [second, third] = [gate(), gate()]
    requests.delete(id)
    scripts.set(id, [
      { calls: [{ name: 'task_focus', args: { task_id: report.id, reason: 'Anna asked for the report' } }] },
      { gate: second.promise, then: { calls: [{ name: 'task_focus', args: { task_id: invoice.id, reason: 'Anna said the invoice comes first' } }] } },
      { gate: third.promise, then: { text: 'Working on the invoice.' } },
    ])
    const step = (n: number) => vi.waitFor(() => expect(requests.get(id)?.length ?? 0).toBeGreaterThanOrEqual(n), { timeout: 10_000 })
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'report, then actually the invoice' } })
    const seen: Array<string | null> = []
    await step(2)
    seen.push(await taskCell())
    second.open()
    await step(3)
    seen.push(await taskCell())
    third.open()
    await settle(id)
    expect((await api<TaskView>(ANNA, `/api/tasks/${report.id}`)).body.attempts).toEqual([expect.objectContaining({ outcome: 'skipped', firstLine: 'Anna said the invoice comes first' })])
    expect((await api<TaskView>(ANNA, `/api/tasks/${invoice.id}`)).body.attempts).toEqual([expect.objectContaining({ outcome: 'ok', firstLine: 'Working on the invoice.' })])
    expect(seen).toEqual([report.id, invoice.id])
  })

  it('focus on none: the Task left ends skipped and the row shows no Task (ao-lj6z)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const report = await create(ANNA, { title: 'Report', assignee: { kind: 'robot', robotId: id } })
    const [, cleared] = await calls(id, [
      { name: 'task_focus', args: { task_id: report.id, reason: 'Anna asked' } },
      { name: 'task_focus', args: { task_id: 'none', reason: 'Anna wants a chat, no Task' } },
    ])
    expect(JSON.parse(cleared!)).toEqual({ focused: null })
    expect((await api<TaskView>(ANNA, `/api/tasks/${report.id}`)).body.attempts).toEqual([expect.objectContaining({ outcome: 'skipped', firstLine: 'Anna wants a chat, no Task' })])
    const row = (await api<Array<{ id: string; lastWakeup: { task: unknown } | null }>>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!
    expect(row.lastWakeup?.task).toBeNull()
  })

  it('the dropped Task starts a fresh attempt at its next Wake-up (ao-n2fo)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const report = await create(ANNA, { title: 'Report', assignee: { kind: 'robot', robotId: id } })
    await calls(id, [
      { name: 'task_focus', args: { task_id: report.id, reason: 'Anna asked' } },
      { name: 'task_focus', args: { task_id: 'none', reason: 'Dropped for the invoice' } },
    ])
    scripts.set(id, [{ text: 'Report written.' }])
    expect((await api(ANNA, `/api/tasks/${report.id}/run`, { body: {} })).status).toBe(200)
    await settle(id)
    expect((await api<TaskView>(ANNA, `/api/tasks/${report.id}`)).body.attempts.map((attempt) => [attempt.outcome, attempt.firstLine])).toEqual([['ok', 'Report written.'], ['skipped', 'Dropped for the invoice']])
  })

  it('gives robot_id to Mr. Robot alone (mc-r4dd)', async () => {
    const id = await robot(ANNA, ['tasks'])
    const other = await robot(ANNA, [])
    const [refused] = await calls(id, [{ name: 'task_list', args: { robot_id: other } }])
    expect(refused).toContain('only Mr. Robot can use robot_id; leave it out to work on your own Tasks')
    expect((await api<TaskPage>(ANNA, '/api/tasks')).body.tasks).toEqual([])
  })
})

describe('Conversations stored with the Routine tools still show their cards, as Task cards (sk-xs60, mc-c2bb)', () => {
  const at = (seq: number, type: string, data: Record<string, unknown>) => ({ seq, type, time: seq * 1000, data }) as unknown as SessionEvent
  const call = (seq: number, callId: string, name: string, args: Record<string, unknown>, result: Record<string, unknown>) => [
    at(seq, 'tool/call', { callId, name, arguments: JSON.stringify(args) }),
    at(seq + 1, 'tool/result', { message: { id: `m${seq}`, toolCallId: callId, content: [{ type: 'text', text: JSON.stringify(result) }] } }),
  ]
  const cards = (events: SessionEvent[], notices: Parameters<typeof projectChat>[0]['notices'] = []) =>
    projectChat({ events, notices, proposal: () => undefined, avatarSeed: 'r-1' }).flatMap((item) => (item.kind === 'task' ? [[item.action, item.title]] : []))

  it('renders schedule_create, schedule_update and schedule_delete as created, updated and cancelled', () => {
    expect(cards([
      ...call(1, 'c1', 'schedule_create', { title: 'Digest', prompt: 'p', daily: { time: '09:00:00' } }, { id: 'schedule-1', title: 'Digest' }),
      ...call(3, 'c2', 'schedule_update', { id: 'schedule-1', title: 'Morning digest' }, { id: 'schedule-1', updated: true, record: { title: 'Morning digest' } }),
      ...call(5, 'c3', 'schedule_delete', { id: 'schedule-1' }, { id: 'schedule-1', deleted: true }),
    ])).toEqual([['created', 'Digest'], ['updated', 'Morning digest'], ['cancelled', 'a Task']])
  })

  it('renders routine_set and routine_delete the same way, a call about another Robot only as activity, and a stored Routine card and Wake-up', () => {
    expect(cards([
      ...call(1, 'c1', 'routine_set', { title: 'Digest', prompt: 'p', daily: { time: '09:00:00' } }, { id: 'r1', name: 'Digest' }),
      ...call(3, 'c2', 'routine_set', { id: 'r1', title: 'Morning' }, { id: 'r1', name: 'Morning' }),
      ...call(5, 'c3', 'routine_delete', { id: 'r1' }, { deleted: 'r1', name: 'Morning' }),
      ...call(7, 'c4', 'routine_set', { robot_id: 'robot-2', title: 'Theirs', prompt: 'p', after_seconds: 3600 }, { id: 'r2', name: 'Theirs' }),
      at(9, 'user/message', { id: 'u9', content: [{ type: 'text', text: '[Routine "Morning" (r1) is due. Nobody is watching this turn.]\nGo.' }], source: { kind: 'routine', routineId: 'r1', name: 'Morning' } }),
    ], [{ id: 'n1', sessionId: 's', afterSeq: 10, at: 10_000, text: 'Routine paused by Mr. Robot: Morning', card: { kind: 'routine', action: 'paused', name: 'Morning', by: 'Mr. Robot' } }])).toEqual([
      ['created', 'Digest'], ['updated', 'Morning'], ['cancelled', 'Morning'], ['ran', 'Morning'], ['paused', 'Morning'],
    ])
  })
})
