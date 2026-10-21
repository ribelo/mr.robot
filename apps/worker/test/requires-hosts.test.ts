import { abortAllDurableObjects, env, reset, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me, ProposalView, RobotSummary, TaskView } from '@mr-robot/protocol'
import { frame } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import type { Space as TestSpace, Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
let annaId = ''
const space = () => env.SPACE.getByName('home') as unknown as DurableObjectStub<TestSpace>
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

const open: WebSocket[] = []
afterEach(async () => {
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await pause(50)
})

/** A paired Host whose app connects, heartbeats, drops and comes back; it answers no calls. */
async function pairedHost(name: string) {
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform: 'linux' }) })
  const { code } = (await start.json()) as { code: string }
  await api(ANNA, `/api/hosts/pair/${code}`, { body: {} })
  const paired = (await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { hostId: string; token: string }
  let socket: WebSocket | undefined
  const connect = async () => {
    const response = await SELF.fetch('https://mr-robot.test/api/host/connect', { headers: { upgrade: 'websocket', 'x-host-id': paired.hostId, authorization: `Bearer ${paired.token}` } })
    socket = response.webSocket!
    socket.accept()
    open.push(socket)
    socket.send(frame({ t: 'hb', d: { version: '0.1.0', instance: 'app-run-1', platform: 'linux', hostname: name, capabilities: { graphical: false, chrome: null, sandbox: 'full', shell: 'bash' } } }))
    await pause(100)
  }
  await connect()
  return {
    hostId: paired.hostId,
    /** The app closes its connection: the Host is offline. */
    drop: async () => { socket!.close(1000); await pause(100) },
    /** The app connects again: the Host is online. */
    back: connect,
  }
}

/** An active Robot holding a files facet on each Host; `requiresHosts` is the setting under test. */
async function robotOn(hostIds: string[], requiresHosts: boolean): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, requiresHosts, grants: { tools: [], skills: [], recipients: [], secrets: [], hosts: hostIds.map((id) => `${id}:files`) } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function create(body: Record<string, unknown>): Promise<TaskView> {
  const created = await api<TaskView & { error?: string }>(ANNA, '/api/tasks', { body })
  expect(created.body.error).toBeUndefined()
  return created.body
}

const attempts = async (taskId: string) => (await api<TaskView>(ANNA, `/api/tasks/${taskId}`)).body.attempts

/** Task Wake-ups the Robot's model was given. */
async function taskTurns(id: string): Promise<number> {
  return (await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'user/message' && JSON.parse(event.data).source?.kind === 'task').length
}

/** What the owner's devices were told that the Robot needs them. */
async function needsYou(): Promise<string[]> {
  const member = env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>
  return (await member.deliveredForTest()).filter((notification) => notification.title.endsWith('needs you')).map((notification) => notification.body)
}

/** The recurring Task's next occurrence is due now, and the Robot's alarm rings. */
async function occurrence(id: string): Promise<void> {
  await space().backdateTasksForTest(16 * 60_000)
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 40; tries += 1) {
    if (await done()) return
    await pause(50)
  }
  throw new Error('timed out waiting')
}

describe('A Robot that waits for its Hosts (v1.16 ticket 05)', () => {
  it('a recurring Task fails without a Turn, naming the Host, and notifies once per outage (ob-5nvd, ob-qgpy)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    const task = await create({ title: 'Clean the disk', instructions: 'Free some space.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } })

    // Online: the Task runs as it always did.
    scripts.set(id, [{ text: 'Cleaned.' }])
    await occurrence(id)
    expect(await taskTurns(id)).toBe(1)

    // Offline: two occurrences fail, no Turn, one notification.
    await desk.drop()
    await occurrence(id)
    await occurrence(id)
    expect(await taskTurns(id)).toBe(1)
    expect((await attempts(task.id)).slice(0, 2)).toEqual([
      expect.objectContaining({ outcome: 'failed', firstLine: expect.stringContaining('"Desk"') }),
      expect.objectContaining({ outcome: 'failed', firstLine: expect.stringContaining('"Desk"') }),
    ])
    expect(await needsYou()).toEqual([expect.stringContaining('Host "Desk" is offline')])

    // Back and gone again is a new outage: the owner hears again.
    await desk.back()
    scripts.set(id, [{ text: 'Cleaned again.' }])
    await occurrence(id)
    expect(await taskTurns(id)).toBe(2)
    await desk.drop()
    await occurrence(id)
    expect(await taskTurns(id)).toBe(2)
    expect(await needsYou()).toHaveLength(2)
  })

  it('a recurring Task of a Robot without the setting still runs with its Host offline (ob-5nvd: off by default)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], false)
    await create({ title: 'Clean the disk', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } })
    await desk.drop()
    scripts.set(id, [{ text: 'Tried.' }])
    await occurrence(id)
    expect(await taskTurns(id)).toBe(1)
    expect(await needsYou()).toEqual([])
  })

  it('only the Hosts the Robot holds a facet on count (ob-5nvd)', async () => {
    const desk = await pairedHost('Desk')
    const studio = await pairedHost('Studio')
    const id = await robotOn([desk.hostId], true)
    await create({ title: 'Clean the disk', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } })
    await studio.drop()
    scripts.set(id, [{ text: 'Cleaned.' }])
    await occurrence(id)
    expect(await taskTurns(id)).toBe(1)
  })

  it('a scheduled Task waits for the Host and runs when its online event comes (ob-e271)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const task = await create({ title: 'Back up photos', instructions: 'Copy the photos.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
    expect(await attempts(task.id)).toEqual([])
    scripts.set(id, [{ text: 'Copied.' }])
    await desk.back()
    await until(async () => (await taskTurns(id)) === 1)
    await settle(id)
    expect(await attempts(task.id)).toEqual([expect.objectContaining({ outcome: 'ok' })])
    // It ran once: a later alarm does not run it again.
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
  })

  it('a scheduled Task fails when its deadline passes before the Host returns, and the owner is told once (ob-e271)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const task = await create({ title: 'Back up photos', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000, deadline: Date.now() + 1500 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    // Parked: no Attempt, and no Turn. Once the deadline has passed, the next look at it ends it failed.
    expect(await attempts(task.id)).toEqual([])
    expect(await taskTurns(id)).toBe(0)
    await pause(1600)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await attempts(task.id)).toEqual([expect.objectContaining({ outcome: 'failed', firstLine: expect.stringContaining('"Desk"') })])
    expect(await needsYou()).toHaveLength(1)
    // The Host's return finds nothing left to run.
    await desk.back()
    await pause(200)
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
  })

  it('a parked Task that was cancelled or reassigned gets no Turn when the Host returns (ob-e271)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const cancelled = await create({ title: 'Back up photos', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    const reassigned = await create({ title: 'Sync notes', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    await api(ANNA, `/api/tasks/${cancelled.id}/cancel`, { body: {} })
    await api(ANNA, `/api/tasks/${reassigned.id}/assign`, { body: { assignee: { kind: 'nobody' } } })
    await desk.back()
    await pause(300)
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
    expect(await attempts(cancelled.id)).toEqual([])
    expect(await attempts(reassigned.id)).toEqual([])
  })

  it('a parked Task released after its deadline fails instead of running (ob-e271)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const task = await create({ title: 'Back up photos', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000, deadline: Date.now() + 1500 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    // The deadline passes and the Host's online event comes before the deadline alarm rings.
    await pause(1600)
    await desk.back()
    await until(async () => (await attempts(task.id)).length === 1)
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
    expect(await attempts(task.id)).toEqual([expect.objectContaining({ outcome: 'failed', firstLine: expect.stringContaining('deadline') })])
  })

  it('the owner\'s message wakes the Robot while a Host is offline (ob-amlz)', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    scripts.set(id, [{ say: 'I am here.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Are you there?' } })
    await settle(id)
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.at(-1)).toMatchObject({ kind: 'reply', text: 'I am here.' })
  })
})

describe('which Hosts count, and what a parked Task does when it changed (deep P10)', () => {
  it("counts only the Hosts where Mr. Robot's owner raised a facet, also in a fresh instance", async () => {
    const desk = await pairedHost('Desk')
    const studio = await pairedHost('Studio')
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false, requiresHosts: true, grants: { hosts: { [`${desk.hostId}:files`]: 'allow' } } } })
    const task = await create({ title: 'Clean the disk', assignee: { kind: 'robot', robotId: mr }, timing: { kind: 'recurring', schedule: { kind: 'interval', everyMinutes: 5 } } })
    // A Turn: he reaches both Hosts now.
    scripts.set(mr, [{ text: 'Cleaned.' }])
    await occurrence(mr)
    expect(await taskTurns(mr)).toBe(1)
    // Studio he holds only as his owner's computer, at his defaults: its outage does not stop his Tasks.
    await studio.drop()
    scripts.set(mr, [{ text: 'Cleaned again.' }])
    await occurrence(mr)
    expect(await taskTurns(mr)).toBe(2)
    // Desk his owner raised to allow: its outage does, also after a restart, before any Turn refreshed what he reaches.
    await desk.drop()
    await abortAllDurableObjects()
    await occurrence(mr)
    expect(await taskTurns(mr)).toBe(2)
    const [failed] = await attempts(task.id)
    expect(failed).toMatchObject({ outcome: 'failed', firstLine: expect.stringContaining('"Desk"') })
    expect(failed!.firstLine).not.toContain('Studio')
  })

  it('a parked Task that was run now gets no second Turn when the Host returns', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const task = await create({ title: 'Back up photos', instructions: 'Copy the photos.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
    scripts.set(id, [{ text: 'Copied.' }, { text: 'Copied again.' }])
    expect((await api(ANNA, `/api/tasks/${task.id}/run`, { body: {} })).status).toBe(200)
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
    await desk.back()
    await pause(300)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
  })

  it('a parked Task given a new time waits for that time; one with new instructions runs them when the Host returns', async () => {
    const desk = await pairedHost('Desk')
    const id = await robotOn([desk.hostId], true)
    await desk.drop()
    const moved = await create({ title: 'Back up photos', instructions: 'Copy the photos.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    const reworded = await create({ title: 'Sync notes', instructions: 'Sync the notes.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(0)
    await api(ANNA, `/api/tasks/${moved.id}`, { method: 'PATCH', body: { timing: { kind: 'scheduled', at: Date.now() + 3_600_000 } } })
    await api(ANNA, `/api/tasks/${reworded.id}`, { method: 'PATCH', body: { instructions: 'Sync the notes and the drafts.' } })
    scripts.set(id, [{ text: 'Synced.' }, { text: 'Not yet.' }])
    await desk.back()
    await until(async () => (await taskTurns(id)) === 1)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(await taskTurns(id)).toBe(1)
    expect(await attempts(moved.id)).toEqual([])
    expect(await attempts(reworded.id)).toEqual([expect.objectContaining({ outcome: 'ok' })])
    const turn = (await env.ROBOT.getByName(id).trajectory()).find((event) => event.type === 'user/message' && JSON.parse(event.data).source?.kind === 'task')!
    expect(turn.data).toContain('Sync the notes and the drafts.')
  })
})

describe('The setup interview proposes the setting (v1.16 ticket 05, ob-kvw3)', () => {
  it('tells the Robot to ask about it when it asks for a Host facet, and approval turns it on', async () => {
    const desk = await pairedHost('Desk')
    scripts.set('*', [{ say: 'Hi! What should I do for you?' }])
    const created = await api<{ id: string }>(ANNA, '/api/robots', { body: { brief: 'keep my disk clean' } })
    const id = created.body.id
    await settle(id)
    const system = JSON.stringify(requests.get(id)![0]!)
    expect(system).toContain('If you ask for a Host facet, first ask your owner whether you should run no Task while any of your Hosts is offline')
    expect(system).toContain('requires_hosts')

    scripts.set(id, [
      { calls: [{ name: 'set_identity', args: { name: 'Cleaner', title: 'Disk', description: 'Keeps the disk clean.', avatar_color: '#3b82f6' } }] },
      { calls: [{ name: 'setup_complete', args: { purpose: 'Clean the disk of Desk nightly', requires_hosts: true, tools: ['tasks'], skills: [], recipients: [], secrets: [], hosts: [`${desk.hostId}:files`] } }] },
      { text: 'Here is what I need.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'Yes, wait for the Host.' } })
    await settle(id)
    const question = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.find((item) => item.kind === 'proposal')
    if (question?.kind !== 'proposal') throw new Error('no setup question')
    expect(question.proposal).toMatchObject({ kind: 'setup', requiresHosts: true })
    expect((await env.ROBOT.getByName(id).settings()).requiresHosts).toBe(false)

    scripts.set(id, [{ text: 'On it.' }])
    const approved = await api<ProposalView>(ANNA, `/api/robots/${id}/proposals/${question.proposal.id}`, { body: { revision: question.proposal.revision, approve: true } })
    expect(approved.body.status).toBe('approved')
    await settle(id)
    expect(await env.ROBOT.getByName(id).settings()).toMatchObject({ requiresHosts: true, grants: { hosts: { [`${desk.hostId}:files`]: 'allow' } } })
  })
})
