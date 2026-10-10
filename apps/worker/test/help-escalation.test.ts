/**
 * need_help escalation (v1.11 ticket 07): an unanswered request wakes the owner's Mr. Robot after 30 minutes, or at once
 * when urgent; he lists and answers requests with help_requests and help_answer; the owner may still answer after him.
 * Time is faked as in the Routine tests: the request moves into the past and the Robot's alarm is run.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyGrants, type Conversation, type ProposalView, type RobotPanel, type RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { mayAnswer } from '../src/robot/programs.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const MINUTE = 60_000
const realFetch = globalThis.fetch

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    return url.startsWith('https://push.example/') ? new Response(null, { status: 201 }) : realFetch(input, init)
  }) as typeof fetch
  await stubModels()
  await api(ANNA, '/api/me', { headers: { 'X-Time-Zone': 'Europe/Warsaw' } })
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Mr. Robot of Anna, ready to run scripted Turns with plain tool calls. */
async function chiefId(): Promise<string> {
  const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(id)
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  return id
}

async function activeRobot(as: string, name: string): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, identity: { name, title: '', description: `${name} does things`, avatarColor: '#8b5cf6' } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const REQUEST = { doing: 'Filing the VAT return', tried: 'Looked in the shared folder and in my notes', need: 'The VAT number of the new company', urgent: false }
const toolText = (message: { content: ReadonlyArray<unknown> }) => message.content.map((block) => ((block as { text?: string }).text ?? '')).join('')
const questions = async (id: string, as = ANNA): Promise<ProposalView[]> => (await api<Conversation>(as, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'question' ? [item.proposal] : []))
const helpOf = async (id: string, request: string) => (await questions(id)).find((proposal) => proposal.id === request)!
const turns = (id: string) => requests.get(id)?.length ?? 0
/** Everything the model was sent at its last step: the Wake-up is in it, after the hidden memory baseline. */
const sent = (id: string) => JSON.stringify(requests.get(id)!.at(-1)!.messages)

/** The Robot asks for help; its Turn ends waiting. */
async function ask(id: string, args: Record<string, unknown> = REQUEST): Promise<ProposalView> {
  scripts.set(id, [{ calls: [{ name: 'need_help', args }] }, { text: 'Waiting for your answer.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'file the return' } })
  await settle(id)
  const open = (await questions(id)).filter((proposal) => proposal.kind === 'help').at(-1)
  if (open === undefined) throw new Error('no help Ask')
  return open
}

/** Time passes for the Robot: its open requests age by `ms` and its alarm runs. */
async function pass(id: string, ms: number): Promise<void> {
  await testRobot(id).backdateHelpForTest(ms)
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

/** Mr. Robot's Turn calls these tools in one step; the results come back as the tools returned them. */
async function chief(id: string, calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<string[]> {
  scripts.set(id, [{ calls }, { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-calls.length).map(toolText)
}

describe('escalation to Mr. Robot (sk-35i9, sk-myhb)', () => {
  it('wakes Mr. Robot with the request after 30 minutes without an answer, once (sk-35i9, sk-myhb)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    expect(request.help).toMatchObject({ escalated: false, override: null })
    // The alarm is planned for the deadline, and nothing wakes him before it.
    expect(await testRobot(robot).alarmForTest()).toBe(request.help!.created + 30 * MINUTE)
    const before = turns(mr)

    await pass(robot, 29 * MINUTE)
    await settle(mr)
    expect(turns(mr)).toBe(before)
    expect((await helpOf(robot, request.id)).help!.escalated).toBe(false)

    scripts.set(mr, [{ text: 'I will look into it.' }])
    await pass(robot, 2 * MINUTE)
    await vi.waitFor(() => expect(turns(mr)).toBe(before + 1))
    await settle(mr)
    const woken = sent(mr)
    expect(woken).toContain(`The Robot \\"Accountant\\" (${robot})`)
    expect(woken).toContain(`Request ${request.id}`)
    expect(woken).toContain('not answered')
    expect(woken).toContain(`Doing: ${REQUEST.doing}`)
    expect(woken).toContain(`Tried: ${REQUEST.tried}`)
    expect(woken).toContain(`Needs: ${REQUEST.need}`)
    for (const name of ['robot_conversation', 'robot_files', 'robot_file_read', 'robot_settings', 'help_answer']) expect(woken).toContain(name)
    expect((await helpOf(robot, request.id)).help!.escalated).toBe(true)

    // Once per request: later alarms do not wake him again.
    await pass(robot, 10 * MINUTE)
    await settle(mr)
    expect(turns(mr)).toBe(before + 1)
  })

  it('wakes Mr. Robot at once when the request is urgent (sk-myhb)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const before = turns(mr)
    scripts.set(mr, [{ text: 'On it.' }])
    const request = await ask(robot, { ...REQUEST, urgent: true })
    await vi.waitFor(() => expect(turns(mr)).toBe(before + 1))
    await settle(mr)
    expect(sent(mr)).toContain('marked it urgent')
    expect(sent(mr)).toContain(`Request ${request.id}`)
    expect((await helpOf(robot, request.id)).help).toMatchObject({ urgent: true, escalated: true })
  })

  it('does not wake Mr. Robot when the owner answered before the deadline (sk-35i9)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    const before = turns(mr)
    scripts.set(robot, [{ text: 'Thanks.' }])
    expect((await api(ANNA, `/api/robots/${robot}/help/${request.id}`, { body: { text: 'PL 123' } })).status).toBe(200)
    await settle(robot)
    await pass(robot, 31 * MINUTE)
    await settle(mr)
    expect(turns(mr)).toBe(before)
    expect(await testRobot(robot).alarmForTest()).toBeNull()
  })

  it("wakes the Robot's owner's Mr. Robot, not anyone else's", async () => {
    const mr = await chiefId()
    const robot = await activeRobot(BEN, 'Bens helper')
    const before = turns(mr)
    scripts.set(robot, [{ calls: [{ name: 'need_help', args: { ...REQUEST, urgent: true } }] }, { text: 'Waiting.' }])
    await api(BEN, `/api/robots/${robot}/messages`, { body: { text: 'go' } })
    const bensChief = (await api<RobotSummary[]>(BEN, '/api/robots')).body.find((entry) => entry.kind === 'mr-robot')!.id
    scripts.set(bensChief, [{ text: 'Looking.' }])
    await settle(robot)
    await vi.waitFor(() => expect(turns(bensChief)).toBeGreaterThan(0))
    expect(turns(mr)).toBe(before)
  })
})

describe('help_requests and help_answer (sk-cj9v, sk-gag7)', () => {
  it('lists the open requests of the owner\'s Robots, not closed ones, not another person\'s', async () => {
    const mr = await chiefId()
    const accountant = await activeRobot(ANNA, 'Accountant')
    const sales = await activeRobot(ANNA, 'Sales')
    const strangers = await activeRobot(BEN, 'Strangers')
    const first = await ask(accountant)
    const second = await ask(sales, { ...REQUEST, need: 'The price list', doing: 'Quoting', tried: 'Asked nobody' })
    scripts.set(strangers, [{ calls: [{ name: 'need_help', args: REQUEST }] }, { text: 'Waiting.' }])
    await api(BEN, `/api/robots/${strangers}/messages`, { body: { text: 'go' } })
    await settle(strangers)
    scripts.set(sales, [{ text: 'ok' }])
    await api(ANNA, `/api/robots/${sales}/help/${second.id}`, { body: { text: 'Here it is' } })
    await settle(sales)
    const third = await ask(sales, { ...REQUEST, need: 'The delivery address' })
    await pass(accountant, 31 * MINUTE)

    const [listed] = (await chief(mr, [{ name: 'help_requests', args: {} }])).map((text) => JSON.parse(text) as { requests: Array<Record<string, unknown>> })
    expect(listed!.requests.map((row) => row['id']).sort()).toEqual([first.id, third.id].sort())
    expect(listed!.requests.find((row) => row['id'] === first.id)).toMatchObject({ robot: 'Accountant', robotId: accountant, urgent: false, escalated: true, ...{ doing: REQUEST.doing, tried: REQUEST.tried, need: REQUEST.need }, created: new Date((await helpOf(accountant, first.id)).help!.created).toISOString() })
    expect(listed!.requests.find((row) => row['id'] === third.id)).toMatchObject({ robot: 'Sales', escalated: false, need: 'The delivery address' })
  })

  it('answers with the label and his name, closes the request, and refuses a second answer (sk-gag7)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    scripts.set(robot, [{ text: 'Thanks, continuing.' }])
    const [result] = await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: 'The number is PL 123-45-67-890; it is in the contract.' } }])
    expect(JSON.parse(result!)).toMatchObject({ requestId: request.id, status: expect.stringContaining('answered') })
    await settle(robot)
    expect(sent(robot)).toContain(`[Answer to your request ${request.id} from Mr. Robot]`)
    expect(sent(robot)).toContain('PL 123-45-67-890')
    expect(await helpOf(robot, request.id)).toMatchObject({ status: 'done', help: { answeredBy: 'mr-robot', answer: 'The number is PL 123-45-67-890; it is in the contract.', override: null } })

    const turnsBefore = turns(robot)
    const [again] = await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: 'Or maybe another number.' } }])
    expect(again).toContain('already answered')
    await settle(robot)
    expect(turns(robot)).toBe(turnsBefore)
    expect(JSON.stringify(requests.get(robot)!.at(-1))).not.toContain('another number')
  })

  it('uses his configured name in the label (sk-gag7)', async () => {
    const mr = await chiefId()
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { identity: { name: 'Jarvis', title: 'Chief of Staff', description: 'Chief', avatarColor: '#8b5cf6' } } })
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    scripts.set(robot, [{ text: 'ok' }])
    await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: 'Use the old one.' } }])
    await settle(robot)
    expect(sent(robot)).toContain(`[Answer to your request ${request.id} from Jarvis]`)
  })

  it("the owner can still answer after him: a labelled override, both answers on the card (sk-q86i)", async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    scripts.set(robot, [{ text: 'First answer received.' }])
    await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: 'Use the old number.' } }])
    await settle(robot)

    scripts.set(robot, [{ text: 'Switching to the new number.' }])
    const owner = await api<ProposalView>(ANNA, `/api/robots/${robot}/help/${request.id}`, { body: { text: 'No: use the new number, 777.' } })
    expect(owner.status).toBe(200)
    expect(owner.body.help).toMatchObject({ answeredBy: 'mr-robot', answer: 'Use the old number.', override: 'No: use the new number, 777.' })
    await settle(robot)
    expect(sent(robot)).toContain(`[Your owner answered your request ${request.id} (after Mr. Robot)]`)
    expect(sent(robot)).toContain('No: use the new number, 777.')
    expect((await helpOf(robot, request.id)).help).toMatchObject({ answer: 'Use the old number.', override: 'No: use the new number, 777.' })

    // The override is one answer: the request stays closed to a third.
    const third = await api(ANNA, `/api/robots/${robot}/help/${request.id}`, { body: { text: 'And again.' } })
    expect(third.status).toBe(409)
  })

  it('refuses Mr. Robot after the owner answered (sk-q86i)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    scripts.set(robot, [{ text: 'ok' }])
    await api(ANNA, `/api/robots/${robot}/help/${request.id}`, { body: { text: 'It is 123.' } })
    await settle(robot)
    const turnsBefore = turns(robot)
    const [refused] = await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: 'It is 456.' } }])
    expect(refused).toContain('your owner already answered')
    await settle(robot)
    expect(turns(robot)).toBe(turnsBefore)
    expect((await helpOf(robot, request.id)).help).toMatchObject({ answeredBy: 'owner', answer: 'It is 123.', override: null })
  })

  it('answers help requests only: any other kind of Ask stays open and the owner\'s (sk-iis1)', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    await env.ROBOT.getByName(robot).proposeFromChief('Mr. Robot asks: it needs the web', { ...emptyGrants, tools: { web: 'allow' } })
    const grants = (await questions(robot)).find((proposal) => proposal.kind === 'grants')!
    const turnsBefore = turns(robot)
    const [refused] = await chief(mr, [{ name: 'help_answer', args: { robot_id: robot, request_id: grants.id, text: 'yes' } }])
    expect(refused).toContain('is not a request for help')
    expect(refused).toContain('only the owner answers')
    expect((await questions(robot)).find((proposal) => proposal.id === grants.id)).toMatchObject({ status: 'open' })

    // No other path of the deputy reaches an Ask's answer: the target refuses the owner's answer methods by name.
    const target = env.ROBOT.getByName(robot) as unknown as { forDeputy(method: string, args: unknown[]): Promise<{ ok: boolean; failure?: { message: string } }> }
    for (const method of ['answer', 'answerToolCall', 'answerProposal']) {
      expect(await target.forDeputy(method, [grants.id, grants.revision, true])).toMatchObject({ ok: false, failure: { message: expect.stringContaining('not open to a deputy') } })
    }
    expect((await questions(robot)).find((proposal) => proposal.id === grants.id)).toMatchObject({ status: 'open' })

    // The answer policy itself: Mr. Robot answers help and nothing else.
    const kinds: ProposalView['kind'][] = ['setup', 'grants', 'member-file', 'skill', 'takeover', 'review', 'thread', 'tool-call', 'help']
    expect(kinds.filter((kind) => mayAnswer(kind, 'mr-robot'))).toEqual(['help'])
    expect(kinds.filter((kind) => mayAnswer(kind, 'owner'))).toEqual(kinds)
    await settle(robot)
    expect(turns(robot)).toBe(turnsBefore)
  })

  it('refuses a request id that does not exist, an empty answer, and a Robot the owner cannot change', async () => {
    const mr = await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const strangers = await activeRobot(BEN, 'Strangers')
    const request = await ask(robot)
    const [unknown, empty, foreign] = await chief(mr, [
      { name: 'help_answer', args: { robot_id: robot, request_id: 'nope', text: 'hi' } },
      { name: 'help_answer', args: { robot_id: robot, request_id: request.id, text: '  ' } },
      { name: 'help_answer', args: { robot_id: strangers, request_id: 'x', text: 'hi' } },
    ])
    expect(unknown).toContain('no request nope')
    expect(empty).toContain('needs text')
    expect(foreign).toContain('no Robot')
    expect((await helpOf(robot, request.id)).status).toBe('open')
  })
})

describe('the panel lists open requests (sk-fmvh)', () => {
  it('shows text, age, urgent and escalated, and drops a request once it is answered', async () => {
    await chiefId()
    const robot = await activeRobot(ANNA, 'Accountant')
    const request = await ask(robot)
    const panel = async () => (await api<RobotPanel>(ANNA, `/api/robots/${robot}/panel`)).body.help
    expect(await panel()).toEqual([{ id: request.id, text: REQUEST.need, urgent: false, created: request.help!.created, escalated: false }])
    await pass(robot, 31 * MINUTE)
    expect(await panel()).toEqual([expect.objectContaining({ id: request.id, escalated: true })])
    scripts.set(robot, [{ text: 'ok' }])
    await api(ANNA, `/api/robots/${robot}/help/${request.id}`, { body: { text: 'done' } })
    await settle(robot)
    expect(await panel()).toEqual([])
  })
})
