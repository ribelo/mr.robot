import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Conversation, TaskView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

/** A gate the scripted model waits at: the Turn is working until the test opens it. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

const textOf = (request: GenerateOptions) => JSON.stringify(request.messages)
const requestsOf = (id: string) => requests.get(id) ?? []
const annaId = async () => (await api<{ id: string }>(ANNA, '/api/me')).body.id

/** The scripted model got its n-th request: the Robot is working. */
async function working(id: string, calls: number): Promise<void> {
  await vi.waitFor(() => expect(requestsOf(id).length).toBeGreaterThanOrEqual(calls), { timeout: 10_000 })
}

/** Turns as DSH logged them: each the event types from turn/start to turn/end; never two open at once (robot-makt). */
async function turns(id: string): Promise<string[][]> {
  const found: string[][] = []
  let open: string[] | undefined
  for (const event of await env.ROBOT.getByName(id).trajectory()) {
    if (event.type === 'turn/start') {
      expect(open).toBeUndefined()
      open = []
    }
    open?.push(event.type)
    if (event.type === 'turn/end') {
      found.push(open!)
      open = undefined
    }
  }
  return found
}

const robotMessage = (from: { robotId: string; ownerId: string; name: string }, text: string, key: string) => ({
  id: `msg-${key}`, kind: 'request' as const, from: { ...from, avatarColor: '#123456' }, text, requestId: `req-${key}`, chain: { id: `c-${key}`, hops: 1 },
})

describe('steer and follow-up (v1.14 ticket 03)', () => {
  it('an owner message during a Task Turn is read at the next step; a webhook waits for its own Turn (ao-9570, ao-m648)', async () => {
    const id = await activeRobot(['tasks'])
    const wait = gate()
    const script: StubReply[] = [
      { gate: wait.promise, then: { text: 'Working on the report.', calls: [{ name: 'task_list', args: {} }] } },
      { text: 'Switched to the invoice as you asked.' },
      { text: 'Webhook noted.' },
    ]
    scripts.set(id, script)
    await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Report', instructions: 'Write the report.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await working(id, 1)

    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'stop, do the invoice first' } })
    const { key } = (await api<{ key: string }>(ANNA, `/api/robots/${id}/webhook`)).body
    expect((await env.ROBOT.getByName(id).receiveWebhook(key, { contentType: 'text/plain', body: 'deploy finished', idempotencyKey: 'w-1' })).accepted).toBe(true)
    wait.open()
    await settle(id)

    const [first, second, third] = requestsOf(id)
    expect(textOf(first!)).not.toContain('stop, do the invoice first')
    // The steer is in the next request of the same Turn; the webhook is not.
    expect(textOf(second!)).toContain('stop, do the invoice first')
    expect(textOf(second!)).not.toContain('deploy finished')
    expect(textOf(third!)).toContain('deploy finished')
    expect((await turns(id)).slice(1)).toHaveLength(2)
  })

  it('the projection shows the steer where the Robot read it, between the replies (ao-lfxt)', async () => {
    const id = await activeRobot()
    const wait = gate()
    scripts.set(id, [{ gate: wait.promise, then: { text: 'Looking at flights.', calls: [{ name: 'my_capabilities', args: {} }] } }, { text: 'Trains, then.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'find me a flight' } })
    await working(id, 1)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'actually trains', clientId: 'c-steer' } })
    wait.open()
    await settle(id)

    // The log holds the steer as a message of the running Turn, after the step that was running when it came.
    const events = await env.ROBOT.getByName(id).trajectory()
    const said = (type: string, text: string) => events.find((event) => event.type === type && JSON.stringify(event.data).includes(text))!.seq
    const consumed = said('user/message', 'actually trains')
    expect(consumed).toBeGreaterThan(said('assistant/message', 'Looking at flights.'))
    expect(consumed).toBeLessThan(said('assistant/message', 'Trains, then.'))
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.seq > said('user/message', 'find me a flight') - 1 && (item.kind === 'message' || item.kind === 'reply'))
    expect(items.map((item) => (item.kind === 'message' || item.kind === 'reply' ? item.text : ''))).toEqual(['find me a flight', 'Looking at flights.', 'actually trains', 'Trains, then.'])
    const steer = items[2]!
    expect(steer.seq).toBe(consumed)
    expect(steer.kind === 'message' && steer.clientId).toBe('c-steer')
    expect((await turns(id)).slice(1)).toHaveLength(1)
  })

  it('the owner on Discord and Mr. Robot as deputy steer; another Robot and a stranger follow up (ao-rsfo, ao-8848)', async () => {
    const id = await activeRobot()
    const owner = await annaId()
    await env.MEMBER.getByName(owner).addConnection({ kind: 'discord-user', label: 'anna', account: 'anna', services: [], shared: false, meta: { userId: 'u-anna' }, secrets: { token: 't' } })
    await env.HOME.getByName('home').discordChannelChanged(id, 'ch-1')
    const wait = gate()
    scripts.set(id, [
      { gate: wait.promise, then: { text: 'On it.', calls: [{ name: 'my_capabilities', args: {} }] } },
      { text: 'Done with all of it.' },
      { text: 'Answered the others.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'start the work' } })
    await working(id, 1)

    const discord = (authorId: string, text: string, key: string) => env.HOME.getByName('home').discordReceived({ id: key, channelId: 'ch-1', guildId: 'g-1', authorId, authorName: authorId, text, direct: false }, owner)
    await discord('u-anna', 'from my phone: hurry', 'd-1')
    await discord('u-stranger', 'hello from a stranger', 'd-2')
    await env.ROBOT.getByName(id).receive(robotMessage({ robotId: `mr-robot-${owner}`, ownerId: owner, name: 'Mr. Robot' }, 'Mr. Robot says: check the calendar too', 'deputy'))
    await env.ROBOT.getByName(id).receive(robotMessage({ robotId: 'r-other', ownerId: owner, name: 'Other' }, 'other robot asks for the file', 'other'))
    wait.open()
    await settle(id)

    const second = textOf(requestsOf(id)[1]!)
    expect(second).toContain('from my phone: hurry')
    expect(second).toContain('Mr. Robot says: check the calendar too')
    expect(second).not.toContain('hello from a stranger')
    expect(second).not.toContain('other robot asks for the file')
    const later = requestsOf(id).slice(2).map(textOf).join('\n')
    expect(later).toContain('hello from a stranger')
    expect(later).toContain('other robot asks for the file')
  })

  it('owner follow-ups queued together become one Turn; a Task queued among them keeps its own (ao-q2z4, ao-rdhs)', async () => {
    const id = await activeRobot(['tasks'])
    const wait = gate()
    scripts.set(id, [
      { gate: wait.promise, then: { text: 'First done.' } },
      { text: 'All three answered.' },
      { text: 'Task done.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'first job' } })
    await working(id, 1)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'later one', clientId: 'c-1', followup: true } })
    const task = (await api<TaskView>(ANNA, '/api/tasks', { body: { title: 'Water', instructions: 'Water the plants.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'unscheduled', deadline: null } } })).body
    expect((await api(ANNA, `/api/tasks/${task.id}/run`, { body: {} })).status).toBe(200)
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'later two', clientId: 'c-2', followup: true } })
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'later three', clientId: 'c-3', followup: true } })
    wait.open()
    await settle(id)

    const [, joined, taskTurn] = requestsOf(id)
    // One user message holds all three, apart; the Task is its own Turn.
    const last = JSON.stringify(joined!.messages.at(-1))
    for (const text of ['later one', 'later two', 'later three']) expect(last).toContain(text)
    expect(last).toContain('next message from the same sender')
    expect(textOf(joined!)).not.toContain('Water the plants.')
    expect(JSON.stringify(taskTurn!.messages.at(-1))).toContain('Water the plants.')
    expect((await turns(id)).slice(1)).toHaveLength(3)

    // The Conversation shows them as the three messages they were, each with its app id.
    const messages = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.filter((item) => item.kind === 'message')
    expect(messages.map((item) => (item.kind === 'message' ? [item.text, item.clientId ?? null] : []))).toEqual([['first job', null], ['later one', 'c-1'], ['later two', 'c-2'], ['later three', 'c-3']])
  })
})
