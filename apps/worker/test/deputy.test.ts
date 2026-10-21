import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type Conversation, type ConversationPage, type ConversationSearchResult, type RobotPanel, type RobotSummary, type TaskPage, type TaskView, type TrajectoryExcerpt, type WorkspaceFileContent, type WorkspaceFileView } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import type { Space as TestSpace } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me', { headers: { 'X-Time-Zone': 'Europe/Warsaw' } })
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

const toolText = (message: { content: ReadonlyArray<unknown> }) => message.content.map((block) => ((block as { text?: string }).text ?? '')).join('')

/** An active Robot of a person, with the given tool groups. */
async function robot(as: string, name: string, tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, {
    method: 'PATCH',
    body: { identity: { name, title: '', description: `${name} does things`, avatarColor: '#8b5cf6' }, grants: { tools, skills: [], recipients: [], secrets: [] } },
  })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function chiefId(): Promise<string> {
  const id = (await robots(ANNA)).find((entry) => entry.kind === 'mr-robot')!.id
  await settle(id)
  return id
}

type Call = { name: string; args: Record<string, unknown> }

/** Mr. Robot's Turn calls these tools in one step; the results come back as the tools returned them. */
async function chief(id: string, calls: Call[]): Promise<string[]> {
  scripts.set(id, [{ calls }, { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-calls.length).map(toolText)
}

async function say(id: string, text: string, reply: string): Promise<void> {
  scripts.set(id, [{ text: reply }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const chat = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body

describe('the deputy sees the Robots the owner reaches (v1.6 ticket 02)', () => {
  it('lists, reads and searches them with the same data the app shows (cd-ibix, cd-gjhb, cd-jltk, cd-r9g5, cd-jc8f, cd-0rqn, cd-ojeh)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant', ['tasks'])
    const sales = await robot(ANNA, 'Sales')
    const strangers = await robot(BEN, 'Strangers')
    await say(accountant, 'The zeppelin invoice is overdue', 'Noted the zeppelin.')
    await api(ANNA, '/api/tasks', { body: { title: 'Digest', instructions: 'Send the digest.', assignee: { kind: 'robot', robotId: accountant }, timing: { kind: 'recurring', schedule: { kind: 'daily', time: '09:00' } } } })
    await env.ROBOT.getByName(accountant).proposeFromChief('Mr. Robot asks: it needs the web', { ...emptyGrants, tools: { web: 'allow' } })

    const [listed, page, found, files, soul, grants, tasks, settings] = (await chief(chiefRobot, [
      { name: 'robot_list', args: {} },
      { name: 'robot_conversation', args: { robot_id: accountant } },
      { name: 'robot_conversation', args: { robot_id: accountant, query: 'zeppelin' } },
      { name: 'robot_files', args: { robot_id: accountant } },
      { name: 'robot_file_read', args: { robot_id: accountant, path: 'SOUL.md' } },
      { name: 'robot_grants', args: { robot_id: accountant } },
      { name: 'task_list', args: { robot_id: accountant, assignee: 'self' } },
      { name: 'robot_settings', args: { robot_id: accountant } },
    ])).map((text) => JSON.parse(text) as never) as unknown as [Array<Record<string, unknown>>, ConversationPage, ConversationSearchResult, { files: WorkspaceFileView[] }, WorkspaceFileContent, { grants: unknown; openProposals: Array<{ purpose: string }> }, { tasks: Array<{ id: string; title: string; last_attempts: unknown[] }> }, { settings: RobotPanel['settings'] }]

    // Everyone the owner reaches except Mr. Robot himself; not another person's private Robot.
    expect(listed.map((entry) => entry['id']).sort()).toEqual([accountant, sales].sort())
    const entry = listed.find((row) => row['id'] === accountant)!
    expect(entry).toMatchObject({ name: 'Accountant', description: 'Accountant does things', kind: 'robot', status: 'active', fleetState: 'waiting for you', model: { provider: 'stub', model: 'stub', effort: 'off' }, mine: true })
    expect(listed.map((row) => row['id'])).not.toContain(strangers)

    // The Conversation is the app's, newest item first.
    expect(page.items).toEqual([...(await chat(accountant))].reverse().slice(0, 20))
    expect(page.nextPage).toBeNull()
    expect(found.items).toEqual([expect.objectContaining({ sender: 'Accountant', snippet: 'Noted the zeppelin.' }), expect.objectContaining({ sender: 'Anna', snippet: 'The zeppelin invoice is overdue' })])

    expect(files.files).toEqual((await api<WorkspaceFileView[]>(ANNA, `/api/robots/${accountant}/files`)).body)
    expect(soul).toEqual((await api<WorkspaceFileContent>(ANNA, `/api/robots/${accountant}/file?path=SOUL.md`)).body)
    const shown = await panel(accountant)
    expect(grants.grants).toEqual(shown.settings.grants)
    expect(grants.openProposals).toEqual([expect.objectContaining({ purpose: 'Mr. Robot asks: it needs the web' })])
    expect(tasks.tasks.map((task) => task.id)).toEqual(shown.tasks.map((task) => task.id))
    expect(tasks.tasks).toEqual([expect.objectContaining({ title: 'Digest', timing: expect.objectContaining({ kind: 'recurring', schedule: { kind: 'daily', time: '09:00' } }), last_attempts: [] })])
    expect(settings.settings).toEqual(shown.settings)
  })

  it('excerpts the Trajectory around an item within a hard size cap (cd-9te1)', async () => {
    const chiefRobot = await chiefId()
    const sales = await robot(ANNA, 'Sales')
    for (let index = 0; index < 12; index += 1) await say(sales, `question ${index}`, `answer ${index} ${'x'.repeat(3_000)}`)
    const first = (await chat(sales)).find((item) => item.kind === 'message')!
    const [small, wide]: Array<TrajectoryExcerpt | undefined> = (await chief(chiefRobot, [
      { name: 'robot_trajectory', args: { robot_id: sales, item_id: first.id, before: 0, after: 2 } },
      { name: 'robot_trajectory', args: { robot_id: sales, item_id: first.id, before: 40, after: 40 } },
    ])).map((text) => JSON.parse(text) as TrajectoryExcerpt)
    expect(small!.seq).toBe(first.seq)
    expect(small!.events[0]).toMatchObject({ seq: first.seq, type: 'user/message' })
    expect(small!.events.length).toBeLessThanOrEqual(3)
    expect(wide!.truncated).toBe(true)
    expect(wide!.events.reduce((sum, event) => sum + event.data.length, 0)).toBeLessThanOrEqual(12_000)
    expect(wide!.events.every((event) => event.data.length <= 1_600)).toBe(true)
  })

  it('has the deputy tools for Mr. Robot only, and only for Robots the owner reaches (cd-2u0h)', async () => {
    const chiefRobot = await chiefId()
    const sales = await robot(ANNA, 'Sales', ['deputy', 'robots', 'files'])
    const strangers = await robot(BEN, 'Strangers')
    const shared = await robot(BEN, 'Shared')
    await api(BEN, `/api/robots/${shared}/settings`, { method: 'PATCH', body: { sharing: 'space' } })

    expect(await env.ROBOT.getByName(sales).toolNames()).not.toContain('robot_list')
    expect(await env.ROBOT.getByName(sales).toolNames()).not.toContain('robot_conversation')
    expect(await env.ROBOT.getByName(chiefRobot).toolNames()).toEqual(expect.arrayContaining(['robot_list', 'robot_conversation', 'robot_trajectory', 'robot_files', 'robot_file_read', 'robot_grants', 'task_list', 'robot_settings']))
    const groups = (await api<{ toolGroups: Array<{ name: string }> }>(ANNA, `/api/robots/${sales}/catalog`)).body.toolGroups.map((group) => group.name)
    expect(groups).not.toContain('deputy')
    expect(groups).not.toContain('robots')

    const [stranger, himself, readShared, writeShared] = await chief(chiefRobot, [
      { name: 'robot_conversation', args: { robot_id: strangers } },
      { name: 'robot_settings', args: { robot_id: chiefRobot } },
      { name: 'robot_conversation', args: { robot_id: shared } },
      { name: 'robot_file_write', args: { robot_id: shared, path: 'MEMORY.md', content: 'mine now' } },
    ])
    expect(stranger!).toContain(`no Robot ${strangers} your owner can reach`)
    expect(himself!).toContain('not for you')
    // A Robot someone shared with the Space can be read, not changed.
    expect(JSON.parse(readShared!)).toMatchObject({ robotId: shared })
    expect(writeShared!).toContain('belongs to someone else')
    expect((await api<WorkspaceFileContent>(BEN, `/api/robots/${shared}/file?path=MEMORY.md`)).body.text).not.toContain('mine now')
  })
})

const notices = async (id: string) => (await chat(id)).flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

describe('the deputy changes files, settings and identity (v1.6 ticket 03)', () => {
  it('writes and deletes Workspace files; the Robot is told and its Conversation shows who (cd-30lq, cd-2zx9)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    const [written, scratch, deleted] = (await chief(chiefRobot, [
      { name: 'robot_file_write', args: { robot_id: accountant, path: 'SOUL.md', content: '# SOUL.md\n\nBe precise about money.\n' } },
      { name: 'robot_file_write', args: { robot_id: accountant, path: 'notes/scratch.md', content: 'old' } },
      { name: 'robot_file_delete', args: { robot_id: accountant, path: 'notes/scratch.md' } },
    ])).map((text) => JSON.parse(text) as Record<string, unknown>)
    expect(written).toMatchObject({ path: 'SOUL.md' })
    expect(scratch).toMatchObject({ path: 'notes/scratch.md', size: 3 })
    expect(deleted).toEqual({ deleted: 'notes/scratch.md' })
    expect((await api<WorkspaceFileContent>(ANNA, `/api/robots/${accountant}/file?path=SOUL.md`)).body.text).toContain('Be precise about money.')
    expect((await api<WorkspaceFileView[]>(ANNA, `/api/robots/${accountant}/files`)).body.map((file) => file.path)).not.toContain('notes/scratch.md')
    expect(await notices(accountant)).toEqual(expect.arrayContaining(['Mr. Robot edited SOUL.md.', 'Mr. Robot edited notes/scratch.md.', 'Mr. Robot deleted notes/scratch.md.']))

    await say(accountant, 'hello', 'Hi.')
    const sent = JSON.stringify(requests.get(accountant)!.at(-1)!.messages)
    expect(sent).toContain('changed: SOUL.md by Mr. Robot')
    expect(sent).toContain('Be precise about money.')
  })

  it('changes the settings it may and refuses grants, spend limit and sharing (cd-hpkr, cd-zm8u, cd-2zx9)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant', ['files'])
    const before = (await panel(accountant)).settings
    const [changed] = (await chief(chiefRobot, [{
      name: 'robot_settings_set',
      args: {
        robot_id: accountant, model: { provider: 'stub', model: 'stub-2' }, thinking: 'high', contextBudget: 40_000,
        compactionInstruction: 'Keep the invoices.', discordProactive: false, notifications: { channels: ['pwa', 'fake'] }, wakeOnScreenNotifications: false,
      },
    }])).map((text) => JSON.parse(text) as RobotPanel['settings'])
    const after = (await panel(accountant)).settings
    expect(changed).toEqual(after)
    expect(after).toMatchObject({
      model: { provider: 'stub', model: 'stub-2', effort: 'high' }, contextBudget: 40_000, compactionInstruction: 'Keep the invoices.',
      discordProactive: false, notifications: { enabled: true, channels: ['pwa', 'fake'] },
      grants: before.grants, spendLimit: before.spendLimit, sharing: before.sharing,
    })
    // The chain is a setting the deputy may set too, with accounts the owner can use (pa-w81r).
    const account = (await api<{ id: string }>(ANNA, '/api/providers/deepseek/accounts', { body: { key: 'sk-anna-deepseek', shared: false } })).body.id
    const ownerId = (await api<{ id: string }>(ANNA, '/api/me')).body.id
    const chain = [{ account, owner: ownerId, provider: 'deepseek', model: 'deepseek-flash', effort: 'low' }, { account: 'workers-ai', owner: '', provider: 'workers-ai', model: 'any', effort: 'off' }]
    const [chained] = (await chief(chiefRobot, [{ name: 'robot_settings_set', args: { robot_id: accountant, chain } }])).map((text) => JSON.parse(text) as RobotPanel['settings'])
    expect(chained!.chain).toEqual(chain)
    const [foreign] = await chief(chiefRobot, [{ name: 'robot_settings_set', args: { robot_id: accountant, chain: [{ ...chain[0], account: 'acc-not-hers' }] } }])
    expect(foreign).toContain('not yours or shared')
    expect(await notices(accountant)).toEqual(expect.arrayContaining([
      'Mr. Robot changed model to stub-2 (stub).', 'Mr. Robot changed thinking to high.',
      'Mr. Robot changed the context budget to 40000 tokens.', 'Mr. Robot changed the compaction instruction.',
      'Mr. Robot changed Discord proactive messages to off.', 'Mr. Robot changed notification channels to pwa, fake.',
    ]))

    const refused = await chief(chiefRobot, [
      { name: 'robot_settings_set', args: { robot_id: accountant, grants: { tools: ['web'], skills: [], recipients: [], secrets: [] } } },
      { name: 'robot_settings_set', args: { robot_id: accountant, spendLimit: { kind: 'usd', amount: 500 } } },
      { name: 'robot_settings_set', args: { robot_id: accountant, sharing: 'space' } },
      { name: 'robot_settings_set', args: { robot_id: accountant, hosts: [] } },
    ])
    expect(refused.every((text) => text.startsWith('Error'))).toBe(true)
    expect(refused[0]).toContain('grants')
    expect(refused[1]).toContain('spend limit')
    expect(refused[2]).toContain('shared')
    const unchanged = (await panel(accountant)).settings
    expect(unchanged).toMatchObject({ grants: before.grants, spendLimit: { kind: 'space' }, sharing: 'private' })
  })

  it('changes the whole identity: name, title, description and avatar colour (cd-28og, cd-2zx9)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    const [done, badColour] = await chief(chiefRobot, [
      { name: 'robot_configure', args: { robot_id: accountant, name: 'Ledger', title: 'Bookkeeper', description: 'Keeps the books.', avatarColor: '#112233' } },
      { name: 'robot_configure', args: { robot_id: accountant, avatarColor: 'red' } },
    ])
    expect(JSON.parse(done!)).toMatchObject({ id: accountant, identity: { name: 'Ledger', title: 'Bookkeeper', description: 'Keeps the books.', avatarColor: '#112233' } })
    expect(badColour!).toContain('#rrggbb')
    expect((await panel(accountant)).settings.identity).toEqual({ name: 'Ledger', title: 'Bookkeeper', description: 'Keeps the books.', avatarColor: '#112233', avatarSeed: accountant })
    expect(await notices(accountant)).toEqual(expect.arrayContaining(['Mr. Robot changed the name to "Ledger".', 'Mr. Robot changed the avatar colour to #112233.']))
  })
})

const taskCards = async (id: string) => (await chat(id)).flatMap((item) => (item.kind === 'task' ? [item] : []))
const space = () => env.SPACE.getByName('space') as unknown as DurableObjectStub<TestSpace>

describe('the deputy works with the Tasks of other Robots; limits and attempts (v1.6 ticket 04, v1.13 ticket 04)', () => {
  it('creates, edits, pauses, resumes and cancels a Task as another Robot, each shown there as a card naming Mr. Robot (cd-n9pi, mc-r4dd)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    await testRobot(accountant).noDreamHourForTest()
    const [created] = await chief(chiefRobot, [{ name: 'task_create', args: { robot_id: accountant, title: 'Weekly digest', instructions: 'Send the digest.', assignee: 'self', timing: { kind: 'recurring', weekly: { time: '09:00', weekdays: [1] } } } }])
    const task = JSON.parse(created!) as { id: string; assignee: string; timing: { schedule: unknown; time_zone: string } }
    expect(task).toMatchObject({ assignee: 'self', timing: { kind: 'recurring', schedule: { kind: 'weekly', time: '09:00', weekdays: [1] }, time_zone: 'Europe/Warsaw', paused: false } })
    const shown = (await panel(accountant)).tasks
    expect(shown).toEqual([expect.objectContaining({ id: task.id, title: 'Weekly digest', assignee: { kind: 'robot', robotId: accountant }, createdBy: expect.objectContaining({ kind: 'robot', robotId: chiefRobot }) })])
    expect(await testRobot(accountant).alarmForTest()).toBe((shown[0]!.timing as { next: number }).next)

    await chief(chiefRobot, [
      { name: 'task_update', args: { robot_id: accountant, task_id: task.id, title: 'Digest', timing: { kind: 'recurring', daily: { time: '08:30' } } } },
      { name: 'task_pause', args: { robot_id: accountant, task_id: task.id } },
      { name: 'task_pause', args: { robot_id: accountant, task_id: task.id, paused: false } },
      { name: 'task_cancel', args: { robot_id: accountant, task_id: task.id } },
    ])
    expect(await testRobot(accountant).alarmForTest()).toBeNull()
    expect((await taskCards(accountant)).map((card) => [card.action, card.title, card.by])).toEqual([
      ['created', 'Weekly digest', 'Mr. Robot'], ['updated', 'Digest', 'Mr. Robot'], ['paused', 'Digest', 'Mr. Robot'], ['resumed', 'Digest', 'Mr. Robot'], ['cancelled', 'Digest', 'Mr. Robot'],
    ])
    // Mr. Robot's own Conversation shows the calls as activity, not as cards of his own.
    expect(await taskCards(chiefRobot)).toEqual([])
  })

  it('keeps the last 20 attempts of a Task and shows them to the owner and to Mr. Robot (cd-3t0p, cd-0rqn, mc-t4dd)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    const task = (await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Pulse', instructions: 'Check prices.', assignee: { kind: 'robot', robotId: accountant }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } } })).body
    for (let index = 0; index < 22; index += 1) {
      scripts.set(accountant, [{ say: `Run ${index} done.\nWith details.` }])
      await space().backdateTasksForTest(5 * 60_000)
      await runDurableObjectAlarm(env.ROBOT.getByName(accountant))
      await settle(accountant)
    }
    const attempts = (await panel(accountant)).tasks[0]!.attempts
    expect(attempts).toHaveLength(20)
    expect(attempts[0]).toMatchObject({ outcome: 'ok', firstLine: 'Run 21 done.', finishedAt: expect.any(Number) })
    expect(attempts.at(-1)!.firstLine).toBe('Run 2 done.')
    const [seen] = await chief(chiefRobot, [{ name: 'task_list', args: { robot_id: accountant, assignee: 'self' } }])
    expect(JSON.parse(seen!).tasks).toEqual([expect.objectContaining({ id: task.id, last_attempts: [expect.objectContaining({ outcome: 'ok', first_line: 'Run 21 done.' }), expect.anything(), expect.anything()] })])
    // 21 Turns: slow when the whole suite shares the machine.
  }, 90_000)

  it('records a due occurrence as skipped while the previous one still waits (cd-d14a)', async () => {
    const accountant = await robot(ANNA, 'Accountant')
    const task = (await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Pulse', instructions: 'Check prices.', assignee: { kind: 'robot', robotId: accountant }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } } })).body
    await api(ANNA, `/api/robots/${accountant}/pause`, { body: {} })
    for (let fired = 0; fired < 2; fired += 1) {
      await space().backdateTasksForTest(5 * 60_000)
      await runDurableObjectAlarm(env.ROBOT.getByName(accountant))
      // A backdated moment can fire the alarm by itself before the test runs it: its work is what counts.
      await settle(accountant)
    }
    const attempts = async () => (await api<TaskView>(ANNA, `/api/tasks/${task.id}`)).body.attempts.map((attempt) => attempt.outcome)
    await vi.waitFor(async () => expect(await attempts()).toEqual(['skipped']), { timeout: 10_000 })
    scripts.set(accountant, [{ text: 'Checked.' }, { text: 'unexpected second Turn' }])
    await api(ANNA, `/api/robots/${accountant}/resume`, { body: {} })
    await settle(accountant)
    expect(await attempts()).toEqual(['ok', 'skipped'])
    expect(scripts.get(accountant)).toEqual([{ text: 'unexpected second Turn' }])
  })

  it('refuses a 51st timed Task and a rule under 5 minutes for the deputy as for the Robot (cd-d14a)', async () => {
    const chiefRobot = await chiefId()
    const full = await robot(ANNA, 'Full', ['tasks'])
    for (let index = 0; index < 50; index += 1) await api(ANNA, '/api/tasks', { body: { title: `Once ${index}`, assignee: { kind: 'robot', robotId: full }, timing: { kind: 'scheduled', at: Date.now() + 3_600_000 + index } } })
    const [fiftyFirst, fast] = await chief(chiefRobot, [
      { name: 'task_create', args: { robot_id: full, title: 'One too many', assignee: 'self', timing: { kind: 'scheduled', at: '2031-01-01T10:00' } } },
      { name: 'task_create', args: { robot_id: full, title: 'Fast', assignee: 'self', timing: { kind: 'recurring', cron: { expression: '* * * * *' } } } },
    ])
    expect(fiftyFirst).toContain('at most 50 scheduled or recurring Tasks')
    expect(fast).toContain('5 minutes')
    expect((await api<TaskPage>(ANNA, `/api/tasks?assignee=robot:${full}`)).body.tasks).toHaveLength(50)
  })
})
