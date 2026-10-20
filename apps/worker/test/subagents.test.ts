/**
 * Subagents (v1.14 ticket 06): the grant and its model list, the tools, the child sessions, the report as a
 * Wake-up, steering and stopping, at most three at once, restart, cascades, cost and masking.
 */
import { abortAllDurableObjects, env, reset, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { RobotPanel, RobotSummary, SubagentView } from '@mr-robot/protocol'
import { REVIEW_POLICY } from '../src/agent/auto-review.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const PASSWORD = 'hunter2-Very-Secret!'
const STUB = { provider: 'stub', model: 'stub' }

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function delegating(options: { models?: Array<{ provider: string; model: string }>; tools?: Record<string, string>; secrets?: string[]; settings?: Record<string, unknown> } = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: {
    codeMode: false,
    grants: { tools: { subagents: 'allow', files: 'allow', ...options.tools }, skills: [], recipients: [], secrets: options.secrets ?? [] },
    subagentModels: options.models ?? [STUB],
    ...options.settings,
  } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const sub = (id: string) => `${id}:sub`
const textOf = (request: GenerateOptions | undefined) => JSON.stringify(request?.messages ?? [])
const toolResults = (request: GenerateOptions) => request.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const list = async (id: string) => (await api<SubagentView[]>(ANNA, `/api/robots/${id}/subagents`)).body
const delegate = (task: string, extra: Record<string, unknown> = {}) => ({ name: 'subagent', args: { description: 'Read the pages', prompt: task, ...extra } })
const until = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 10_000 })
const row = async (id: string) => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!

describe('the subagents grant and its model list (ao-zzga, ao-2z4n, ao-r3oq)', () => {
  it('an empty list refuses delegation; a listed model is accepted; an unlisted one is refused', async () => {
    const empty = await delegating({ models: [] })
    await say(empty, 'go', [{ calls: [delegate('x')] }, { text: 'Cannot.' }])
    expect(toolResults(requests.get(empty)!.at(-1)!).at(-1)).toContain('allowed no models for Subagents')

    const id = await delegating()
    scripts.set(sub(id), [{ text: 'REPORT: done.' }])
    await say(id, 'go', [{ calls: [delegate('Read A', { provider: 'stub', model: 'other' }), delegate('Read B', STUB)] }, { text: 'Started.' }, { text: 'Got the report.' }])
    const [unlisted, listed] = toolResults(requests.get(id)![1]!)
    expect(unlisted).toContain('stub/other is not a model your owner allowed for Subagents. Allowed: stub/stub')
    expect(JSON.parse(listed!)).toMatchObject({ kind: 'activation', subagentId: expect.stringMatching(/^sa-/) })
    // Not granted: no tool at all.
    expect(requests.get(empty)![0]!.tools?.some((tool) => tool.name === 'subagent')).toBe(true)
    const none = await delegating({ tools: { subagents: 'deny' } })
    await say(none, 'go', [{ text: 'Ok.' }])
    expect(requests.get(none)![0]!.tools?.map((tool) => tool.name)).not.toContain('subagent')
  })
})

describe('the list is a setting the owner and Mr. Robot edit (ao-2z4n)', () => {
  it('Mr. Robot as deputy sets the list; the grant itself stays with the owner', async () => {
    const id = await delegating({ models: [] })
    const chief = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.kind === 'mr-robot')!.id
    await settle(chief)
    await env.ROBOT.getByName(chief).updateSettings({ codeMode: false })
    await say(chief, 'let it delegate', [{ calls: [{ name: 'robot_settings_set', args: { robot_id: id, subagentModels: [STUB] } }] }, { text: 'Done.' }])
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.subagentModels).toEqual([STUB])
    await say(chief, 'and grant it', [{ calls: [{ name: 'robot_settings_set', args: { robot_id: id, grants: { tools: { subagents: 'allow' } } } }] }, { text: 'Refused.' }])
    expect(toolResults(requests.get(chief)!.at(-1)!).at(-1)).toContain('Grants stay with your owner')
  })
})

describe('a Subagent (ao-8s1d, ao-sbc9, ao-3umf, ao-w9lq)', () => {
  it('has no delegation or excluded tools; an Ask-level call fails, and its report wakes the Robot after its Turn ended', async () => {
    const id = await delegating({ tools: { notify: 'ask', messaging: 'allow' } })
    const wait = gate()
    scripts.set(sub(id), [
      { gate: wait.promise, then: { calls: [{ name: 'notify_owner', args: { text: 'Done!', reason: 'tell Anna' } }] } },
      { text: 'REPORT: the notification needs Anna; please ask her.' },
    ])
    await say(id, 'delegate it', [{ calls: [delegate('Notify Anna when done')] }, { text: 'A Subagent is on it.' }])
    // The Robot's Turn is over while its Subagent works; the row says it works.
    expect((await row(id)).fleetState).toBe('working')
    expect((await row(id)).subagents).toEqual([expect.objectContaining({ label: 'Read the pages' })])
    const offered = requests.get(sub(id))![0]!.tools!.map((tool) => tool.name)
    for (const name of ['subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents', 'robot_send', 'robot_directory', 'propose_grants', 'propose_review', 'ask', 'request_credential', 'say', 'react', 'propose_member_file_edit']) expect(offered).not.toContain(name)
    expect(offered).toContain('write')
    expect(offered).toContain('notify_owner')
    expect(textOf(requests.get(sub(id))![0])).toContain('Notify Anna when done')

    scripts.set(id, [{ text: 'I will ask Anna myself.' }])
    wait.open()
    await until(() => expect(requests.get(id)!.length).toBe(3))
    await settle(id)
    expect(toolResults(requests.get(sub(id))!.at(-1)!).at(-1)).toContain('A Subagent cannot ask Anna: notify_owner needs their answer')
    expect(textOf(requests.get(id)!.at(-1))).toContain('REPORT: the notification needs Anna; please ask her.')
    expect(await list(id)).toEqual([expect.objectContaining({ status: 'done', result: 'REPORT: the notification needs Anna; please ask her.', model: { ...STUB, effort: 'off' } })])
    expect((await row(id)).subagents ?? []).toEqual([])
  })

  it('send_message steers a running Subagent and interrupt_agent stops it (ao-nc31)', async () => {
    const id = await delegating()
    const wait = gate()
    scripts.set(sub(id), [{ gate: wait.promise, then: { calls: [{ name: 'glob', args: { pattern: '**' } }] } }, { text: 'Checked A and B.' }])
    await say(id, 'go', [{ calls: [delegate('Check A')] }, { text: 'Started.' }])
    const [child] = await list(id)
    await say(id, 'also B', [{ calls: [{ name: 'send_message', args: { agent_id: child!.id, message: 'Also check B.' } }] }, { text: 'Told it.' }])
    wait.open()
    scripts.set(id, [{ text: 'Report read.' }])
    await until(async () => expect((await list(id))[0]!.status).toBe('done'))
    expect(textOf(requests.get(sub(id))!.at(-1))).toContain('Also check B.')

    const hang = gate()
    scripts.set(sub(id), [{ gate: hang.promise, then: { hang: true } }])
    await say(id, 'another', [{ calls: [delegate('Long job')] }, { text: 'Started.' }])
    const running = (await list(id)).find((entry) => entry.status === 'running')!
    scripts.set(id, [{ calls: [{ name: 'interrupt_agent', args: { agent_id: running.id } }] }, { text: 'Stopped it.' }, { text: 'Noted.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'stop it' } })
    hang.open()
    await until(async () => expect((await list(id)).find((entry) => entry.id === running.id)!.status).toBe('interrupted'))
    await settle(id)
    await until(() => expect(textOf(requests.get(id)!.at(-1))).toContain('was interrupted'))
  })

  it('a fourth Subagent at once is refused (ao-6jz6)', async () => {
    const id = await delegating()
    const wait = gate()
    scripts.set(sub(id), [1, 2, 3].map(() => ({ gate: wait.promise, then: { text: 'Done.' } })))
    await say(id, 'go', [{ calls: [delegate('One'), delegate('Two'), delegate('Three'), delegate('Four')] }, { text: 'Started three.' }])
    const results = toolResults(requests.get(id)!.at(-1)!)
    expect(results.filter((text) => text.includes('"activation"'))).toHaveLength(3)
    expect(results.filter((text) => text.includes('At most 3 Subagents run at once'))).toHaveLength(1)
    wait.open()
  })

  it('a platform restart resumes a running Subagent with the restart note (ao-ij3i)', async () => {
    const id = await delegating()
    scripts.set(sub(id), [{ hang: true }])
    await say(id, 'go', [{ calls: [delegate('Long read')] }, { text: 'Started.' }])
    await abortAllDurableObjects()
    scripts.set(sub(id), [{ text: 'REPORT: finished after the restart.' }])
    scripts.set(id, [{ text: 'Got it.' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await until(async () => expect((await list(id))[0]!.status).toBe('done'))
    expect(textOf(requests.get(sub(id))!.at(-1))).toContain('interrupted by a platform restart')
    await until(() => expect(textOf(requests.get(id)!.at(-1))).toContain('REPORT: finished after the restart.'))
  })
})

describe('cascades, cost and masking (ao-qy77, ao-3pl8, ao-xl6g, ao-2fgp, ao-6boj)', () => {
  it('interrupting the Robot stops its Subagents; a rewind before the delegation archives them; deleting the Robot deletes them', async () => {
    const id = await delegating()
    scripts.set(sub(id), [{ hang: true }])
    const wait = gate()
    scripts.set(id, [{ calls: [delegate('Long read')] }, { gate: wait.promise, then: { hang: true } }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await until(async () => expect(await list(id)).toHaveLength(1))
    const interrupted = await api(ANNA, `/api/robots/${id}/interrupt`, { body: {} })
    expect(interrupted.status, JSON.stringify(interrupted.body)).toBe(200)
    wait.open()
    await settle(id)
    await until(async () => expect((await list(id))[0]!.status).toBe('interrupted'))

    scripts.set(sub(id), [{ hang: true }])
    await say(id, 'once more', [{ calls: [delegate('Second read')] }, { say: 'Started.' }])
    const turns = (await env.ROBOT.getByName(id).trajectory()).filter((event) => event.type === 'turn/start').length
    const rewound = await api(ANNA, `/api/robots/${id}/rewind`, { body: { beforeTurn: turns } })
    expect(rewound.status, JSON.stringify(rewound.body)).toBe(200)
    expect(await list(id)).toEqual([])
    expect(await testRobot(id).subagentStatusesForTest()).toContain('archived')

    expect((await api(ANNA, `/api/robots/${id}`, { method: 'DELETE', body: { confirm: 'New robot' } })).status).toBe(200)
    expect(await testRobot(id).subagentStatusesForTest()).toEqual([])
  })

  it('Subagent tokens are the Robot\'s Subagent cost; past the spend limit the Subagents stop first', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { models: [{ provider: 'stub', model: 'stub', label: 'Stub', contextWindow: 128000, price: { input: 4000, output: 4000 } }], robotSpendLimit: { kind: 'usd', amount: 2 } } })
    const id = await delegating()
    const hold = gate()
    scripts.set(sub(id), [{ calls: [{ name: 'glob', args: { pattern: '**' } }], inputTokens: 600 } as never, { calls: [{ name: 'glob', args: { pattern: '**' } }] }, { gate: hold.promise, then: { text: 'Never reached.' } }])
    await say(id, 'go', [{ calls: [delegate('Expensive read')] }, { text: 'Started.' }])
    await until(async () => expect((await list(id))[0]!.status).toBe('interrupted'))
    hold.open()
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.usage.breakdown.model.subagent).toBeGreaterThan(0)
    expect(panel.summary.status).toBe('blocked')
  })

  it('a secret a Subagent reads is masked in its log; a Subagent is no Robot and no doer; its calls are reviewed with the Robot\'s setting', async () => {
    await api(ANNA, '/api/secrets/allegro', { method: 'PUT', body: { password: PASSWORD, allowRead: true, shared: false } })
    const id = await delegating({ tools: { secrets: 'allow', tasks: 'allow' }, secrets: ['allegro'] })
    scripts.set(sub(id), [{ calls: [{ name: 'secret_get', args: { name: 'allegro' } }] }, { text: `Logged in with ${PASSWORD}.` }])
    await say(id, 'go', [{ calls: [delegate('Log in')] }, { text: 'Started.' }, { text: 'Thanks.' }])
    await until(async () => expect((await list(id))[0]!.status).toBe('done'))
    await settle(id)
    const child = (await list(id))[0]!
    const events = await (await SELF.fetch(`https://mr-robot.test/api/robots/${id}/subagents/${child.id}/events`, { headers: { 'x-dev-identity': ANNA } })).text()
    expect(events).not.toContain(PASSWORD)
    expect(events).toContain('[secret:allegro]')
    const chat = JSON.stringify((await api(ANNA, `/api/robots/${id}/subagents/${child.id}/conversation`)).body)
    expect(chat).not.toContain(PASSWORD)

    // Not a Robot: not in the list, the directory or Mission Control's Fleet; not a Task's doer.
    expect((await api<RobotSummary[]>(ANNA, '/api/robots')).body.map((entry) => entry.id)).not.toContain(child.id)
    await say(id, 'give it a task', [{ calls: [{ name: 'task_create', args: { title: 'For the child', assignee: `robot:${child.id}` } }] }, { text: 'Refused.' }])
    expect(toolResults(requests.get(id)!.at(-1)!).at(-1)).not.toContain('"id"')

    // Auto review checks the Subagent's calls with the Robot's setting.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { autoReview: true } })
    const wait = gate()
    scripts.set(sub(id), [{ gate: wait.promise, then: { calls: [{ name: 'write', args: { file_path: 'notes/x.md', content: 'x' } }] } }, { text: 'Wrote it.' }])
    // The Robot's own call is reviewed first.
    await say(id, 'note it', [{ calls: [delegate('Write a note')] }, { text: '{"risk":"low","decision":"allow"}' }, { text: 'Started.' }])
    // The reviewer runs on the Robot's model; then the report wakes the Robot.
    scripts.set(id, [{ text: '{"risk":"low","decision":"allow"}' }, { text: 'Thanks.' }])
    wait.open()
    await until(async () => expect((await list(id)).filter((entry) => entry.status === 'done')).toHaveLength(2))
    const reviews = (requests.get(id) ?? []).filter((request) => request.system === REVIEW_POLICY)
    expect(reviews).toHaveLength(2)
    expect(JSON.stringify(reviews[1]!.messages)).toContain('direct-parent-instruction')
    expect(JSON.stringify(reviews[1]!.messages)).toContain('notes/x.md')
    expect(await testRobot(id).fileForTest('notes/x.md')).toBe('x')
  })
})
