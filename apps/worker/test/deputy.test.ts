import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyGrants, type Conversation, type ConversationPage, type ConversationSearchResult, type RobotPanel, type RobotSummary, type RoutineView, type TrajectoryExcerpt, type WorkspaceFileContent, type WorkspaceFileView } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

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
    body: { codeMode: false, identity: { name, title: '', description: `${name} does things`, avatarColor: '#8b5cf6' }, grants: { tools, skills: [], recipients: [], secrets: [] } },
  })
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
    const accountant = await robot(ANNA, 'Accountant', ['routines'])
    const sales = await robot(ANNA, 'Sales')
    const strangers = await robot(BEN, 'Strangers')
    await say(accountant, 'The zeppelin invoice is overdue', 'Noted the zeppelin.')
    scripts.set(accountant, [{ calls: [{ name: 'schedule_create', args: { title: 'Digest', prompt: 'Send the digest.', daily: { time: '09:00:00', time_zone: 'Europe/Warsaw' } } }] }, { text: 'Scheduled.' }])
    await api(ANNA, `/api/robots/${accountant}/messages`, { body: { text: 'every day please' } })
    await settle(accountant)
    await env.ROBOT.getByName(accountant).proposeFromChief('Mr. Robot asks: it needs the web', { ...emptyGrants, tools: { web: 'allow' } })

    const [listed, page, found, files, soul, grants, routines, settings] = (await chief(chiefRobot, [
      { name: 'robot_list', args: {} },
      { name: 'robot_conversation', args: { robot_id: accountant } },
      { name: 'robot_conversation', args: { robot_id: accountant, query: 'zeppelin' } },
      { name: 'robot_files', args: { robot_id: accountant } },
      { name: 'robot_file_read', args: { robot_id: accountant, path: 'SOUL.md' } },
      { name: 'robot_grants', args: { robot_id: accountant } },
      { name: 'robot_routines', args: { robot_id: accountant } },
      { name: 'robot_settings', args: { robot_id: accountant } },
    ])).map((text) => JSON.parse(text) as never) as unknown as [Array<Record<string, unknown>>, ConversationPage, ConversationSearchResult, { files: WorkspaceFileView[] }, WorkspaceFileContent, { grants: unknown; openProposals: Array<{ purpose: string }> }, RoutineView[], { settings: RobotPanel['settings'] }]

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
    expect(routines).toEqual(shown.routines)
    expect(routines).toEqual([expect.objectContaining({ name: 'Digest', summary: 'Daily at 09:00', runs: [] })])
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
    await api(BEN, `/api/robots/${shared}/settings`, { method: 'PATCH', body: { sharing: 'home' } })

    expect(await env.ROBOT.getByName(sales).toolNames()).not.toContain('robot_list')
    expect(await env.ROBOT.getByName(sales).toolNames()).not.toContain('robot_conversation')
    expect(await env.ROBOT.getByName(chiefRobot).toolNames()).toEqual(expect.arrayContaining(['robot_list', 'robot_conversation', 'robot_trajectory', 'robot_files', 'robot_file_read', 'robot_grants', 'robot_routines', 'robot_settings']))
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
    // A Robot someone shared with the Home can be read, not changed.
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
        robot_id: accountant, model: { provider: 'stub', model: 'stub-2' }, thinking: 'high', codeMode: true, contextBudget: 40_000,
        compactionInstruction: 'Keep the invoices.', discordProactive: false, notifications: { channels: ['pwa', 'fake'] }, wakeOnScreenNotifications: false,
      },
    }])).map((text) => JSON.parse(text) as RobotPanel['settings'])
    const after = (await panel(accountant)).settings
    expect(changed).toEqual(after)
    expect(after).toMatchObject({
      model: { provider: 'stub', model: 'stub-2', effort: 'high' }, codeMode: true, contextBudget: 40_000, compactionInstruction: 'Keep the invoices.',
      discordProactive: false, notifications: { enabled: true, channels: ['pwa', 'fake'] },
      grants: before.grants, spendLimitUsd: before.spendLimitUsd, sharing: before.sharing,
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
      'Mr. Robot changed model to stub-2 (stub).', 'Mr. Robot changed thinking to high.', 'Mr. Robot changed code mode to on.',
      'Mr. Robot changed the context budget to 40000 tokens.', 'Mr. Robot changed the compaction instruction.',
      'Mr. Robot changed Discord proactive messages to off.', 'Mr. Robot changed notification channels to pwa, fake.',
    ]))

    const refused = await chief(chiefRobot, [
      { name: 'robot_settings_set', args: { robot_id: accountant, grants: { tools: ['web'], skills: [], recipients: [], secrets: [] } } },
      { name: 'robot_settings_set', args: { robot_id: accountant, spendLimitUsd: 500 } },
      { name: 'robot_settings_set', args: { robot_id: accountant, sharing: 'home' } },
      { name: 'robot_settings_set', args: { robot_id: accountant, hosts: [] } },
    ])
    expect(refused.every((text) => text.startsWith('Error'))).toBe(true)
    expect(refused[0]).toContain('grants')
    expect(refused[1]).toContain('spend limit')
    expect(refused[2]).toContain('shared')
    const unchanged = (await panel(accountant)).settings
    expect(unchanged).toMatchObject({ grants: before.grants, spendLimitUsd: null, sharing: 'private' })
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
    expect((await panel(accountant)).settings.identity).toEqual({ name: 'Ledger', title: 'Bookkeeper', description: 'Keeps the books.', avatarColor: '#112233' })
    expect(await notices(accountant)).toEqual(expect.arrayContaining(['Mr. Robot changed the name to "Ledger".', 'Mr. Robot changed the avatar colour to #112233.']))
  })
})

const routineCards = async (id: string) => (await chat(id)).flatMap((item) => (item.kind === 'routine' ? [item] : []))

describe('the deputy runs Routines for other Robots; limits and run history (v1.6 ticket 04)', () => {
  it('creates, edits, pauses, resumes and deletes a Routine, each shown as a card naming Mr. Robot (cd-n9pi)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    const [created] = await chief(chiefRobot, [{ name: 'robot_routine_set', args: { robot_id: accountant, title: 'Weekly digest', prompt: 'Send the digest.', weekly: { time: '09:00:00', weekdays: [1] } } }])
    const routine = JSON.parse(created!) as RoutineView
    expect(routine).toMatchObject({ name: 'Weekly digest', summary: 'Mondays at 09:00', timeZone: 'Europe/Warsaw', paused: false })
    expect((await panel(accountant)).routines).toEqual([routine])
    expect(await testRobot(accountant).alarmForTest()).toBe(routine.nextRun)

    const [edited, paused, resumed] = (await chief(chiefRobot, [
      { name: 'robot_routine_set', args: { robot_id: accountant, id: routine.id, title: 'Digest', daily: { time: '08:30:00' } } },
      { name: 'robot_routine_pause', args: { robot_id: accountant, id: routine.id } },
      { name: 'robot_routine_pause', args: { robot_id: accountant, id: routine.id, paused: false } },
    ])).map((text) => JSON.parse(text) as RoutineView)
    expect(edited).toMatchObject({ id: routine.id, name: 'Digest', summary: 'Daily at 08:30' })
    expect(paused).toMatchObject({ paused: true, nextRun: null })
    expect(resumed!.paused).toBe(false)
    expect(resumed!.nextRun).toBeGreaterThan(Date.now())

    expect((await chief(chiefRobot, [{ name: 'robot_routine_delete', args: { robot_id: accountant, id: routine.id } }]))[0]).toContain(routine.id)
    expect((await panel(accountant)).routines).toEqual([])
    expect(await testRobot(accountant).alarmForTest()).toBeNull()
    expect((await routineCards(accountant)).map((card) => [card.action, card.name, card.by])).toEqual([
      ['created', 'Weekly digest', 'Mr. Robot'], ['updated', 'Digest', 'Mr. Robot'], ['paused', 'Digest', 'Mr. Robot'], ['resumed', 'Digest', 'Mr. Robot'], ['deleted', 'Digest', 'Mr. Robot'],
    ])
  })

  it('keeps the last 20 runs of a Routine and shows them to the owner and to Mr. Robot (cd-3t0p, cd-0rqn)', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    const [created] = await chief(chiefRobot, [{ name: 'robot_routine_set', args: { robot_id: accountant, title: 'Pulse', prompt: 'Check prices.', every_seconds: 300 } }])
    const routine = JSON.parse(created!) as RoutineView
    for (let index = 0; index < 22; index += 1) {
      scripts.set(accountant, [{ text: `Run ${index} done.\nWith details.` }])
      await testRobot(accountant).backdateRoutinesForTest(1000)
      await runDurableObjectAlarm(env.ROBOT.getByName(accountant))
      await settle(accountant)
    }
    const runs = (await panel(accountant)).routines[0]!.runs
    expect(runs).toHaveLength(20)
    expect(runs[0]).toMatchObject({ outcome: 'ok', firstLine: 'Run 21 done.', finishedAt: expect.any(Number) })
    expect(runs[0]!.finishedAt).toBeGreaterThanOrEqual(runs[0]!.startedAt)
    expect(runs.at(-1)!.firstLine).toBe('Run 2 done.')
    const [seen] = await chief(chiefRobot, [{ name: 'robot_routines', args: { robot_id: accountant } }])
    expect(JSON.parse(seen!)).toEqual([expect.objectContaining({ id: routine.id, runs })])
  })

  it('records a due run as skipped while the previous one still waits', async () => {
    const chiefRobot = await chiefId()
    const accountant = await robot(ANNA, 'Accountant')
    await chief(chiefRobot, [{ name: 'robot_routine_set', args: { robot_id: accountant, title: 'Pulse', prompt: 'Check prices.', every_seconds: 300 } }])
    await api(ANNA, `/api/robots/${accountant}/pause`, { body: {} })
    for (let fired = 0; fired < 2; fired += 1) {
      await testRobot(accountant).backdateRoutinesForTest(1000)
      await runDurableObjectAlarm(env.ROBOT.getByName(accountant))
    }
    expect((await panel(accountant)).routines[0]!.runs.map((run) => run.outcome)).toEqual(['skipped', 'running'])
    scripts.set(accountant, [{ text: 'Checked.' }, { text: 'unexpected second Turn' }])
    await api(ANNA, `/api/robots/${accountant}/resume`, { body: {} })
    await settle(accountant)
    expect((await panel(accountant)).routines[0]!.runs.map((run) => run.outcome)).toEqual(['skipped', 'ok'])
    expect(scripts.get(accountant)).toEqual([{ text: 'unexpected second Turn' }])
  })

  it('refuses a 51st Routine and an interval under 5 minutes, for the Robot and the deputy alike (cd-d14a)', async () => {
    const chiefRobot = await chiefId()
    const full = await robot(ANNA, 'Full', ['routines'])
    const free = await robot(ANNA, 'Free', ['routines'])
    scripts.set(full, [
      { calls: Array.from({ length: 51 }, (_, index) => ({ name: 'schedule_create', args: { title: `Once ${index}`, prompt: 'Later.', after_seconds: 3_600 + index } })) },
      { text: 'Created.' },
    ])
    await api(ANNA, `/api/robots/${full}/messages`, { body: { text: 'fill up' } })
    await settle(full)
    const results = requests.get(full)!.at(-1)!.messages.filter((message) => message.role === 'tool').map(toolText)
    expect(results).toHaveLength(51)
    expect(results.at(-1)).toContain('50')
    expect((await panel(full)).routines).toHaveLength(50)

    scripts.set(free, [
      { calls: [
        { name: 'schedule_create', args: { title: 'Fast', prompt: 'Often.', every_seconds: 120 } },
        { name: 'schedule_create', args: { title: 'Cron fast', prompt: 'Often.', cron: { expression: '*/2 * * * *', time_zone: 'Europe/Warsaw' } } },
        { name: 'schedule_create', args: { title: 'Cron ok', prompt: 'Hourly.', cron: { expression: '0 * * * *', time_zone: 'Europe/Warsaw' } } },
      ] },
      { text: 'Tried.' },
    ])
    await api(ANNA, `/api/robots/${free}/messages`, { body: { text: 'try' } })
    await settle(free)
    const own = requests.get(free)!.at(-1)!.messages.filter((message) => message.role === 'tool').map(toolText)
    expect(own[0]).toContain('5 minutes')
    expect(own[1]).toContain('5 minutes')
    expect(own[2]).toContain('Cron ok')
    expect((await panel(free)).routines.map((routine) => routine.name)).toEqual(['Cron ok'])

    const [fiftyFirst, fast, fastCron, edit] = await chief(chiefRobot, [
      { name: 'robot_routine_set', args: { robot_id: full, title: 'One too many', prompt: 'x', after_seconds: 7_200 } },
      { name: 'robot_routine_set', args: { robot_id: free, title: 'Fast', prompt: 'x', every_seconds: 60 } },
      { name: 'robot_routine_set', args: { robot_id: free, title: 'Fast cron', prompt: 'x', cron: { expression: '* * * * *' } } },
      { name: 'robot_routine_set', args: { robot_id: free, id: (await panel(free)).routines[0]!.id, every_seconds: 240 } },
    ])
    expect(fiftyFirst).toContain('50')
    expect(fast).toContain('5 minutes')
    expect(fastCron).toContain('5 minutes')
    expect(edit).toContain('5 minutes')
    expect((await panel(full)).routines).toHaveLength(50)
    expect((await panel(free)).routines).toHaveLength(1)
  })
})
