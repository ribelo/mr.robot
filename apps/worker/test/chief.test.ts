/**
 * The chief question and the end of need_help (v1.15 ticket 04, gb-qmnc, gb-l1x1, gb-c0ub): every Robot can message its owner's Mr. Robot,
 * robot_send takes a question flag, and need_help, help_requests and help_answer are gone while an open help Ask can still be answered.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Me, ProposalView, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, wakeOf } from './stub-llm.ts'

const ANNA = 'anna@example.com'
let annaId = ''
let chiefId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  chiefId = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(chiefId)
})

async function newRobot(): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  return body.id
}

async function activeRobot(): Promise<string> {
  const id = await newRobot()
  await testRobot(id).activateForTest()
  return id
}

const grantsOf = async (id: string) => (await env.ROBOT.getByName(id).settings()).grants
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const chat = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items

describe('the chief recipient Grant (gb-qmnc)', () => {
  it('a new Robot holds it, and the messaging group to use it; Mr. Robot holds neither as a row', async () => {
    const id = await newRobot()
    expect(await grantsOf(id)).toMatchObject({ tools: { messaging: 'allow' }, recipients: { [chiefId]: 'allow' } })
    expect(chiefId).toBe(`mr-robot-${annaId}`)
    expect(Object.keys((await grantsOf(chiefId)).recipients)).not.toContain(chiefId)
  })

  it('the upgrade gives it to a Robot that exists once; Mr. Robot is the chief and gets none', async () => {
    const id = await activeRobot()
    await testRobot(id).withoutChiefGrantForTest()
    expect(await grantsOf(id)).toMatchObject({ tools: { messaging: 'allow' }, recipients: { [chiefId]: 'allow' } })
    // Taken away by the owner, it stays away: the upgrade runs once.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { messaging: 'allow' }, skills: [], recipients: [], secrets: [] } } })
    expect((await grantsOf(id)).recipients).toEqual({})
    expect(Object.keys((await grantsOf(chiefId)).recipients)).not.toContain(chiefId)
  })

  it('shows it in the Robot\'s Grants for the owner to remove, and robot_send to the chief then refuses', async () => {
    const id = await activeRobot()
    scripts.set(id, [{ calls: [{ name: 'robot_directory', args: {} }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'who can I ask?' } })
    await settle(id)
    expect(JSON.parse(toolResults(id).at(-1)!).robots).toEqual([expect.objectContaining({ id: chiefId, name: 'Mr. Robot' })])

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { messaging: 'allow' }, skills: [], recipients: [], secrets: [] } } })
    scripts.set(id, [{ calls: [{ name: 'robot_send', args: { to: chiefId, request: 'Which supplier do we use?', idempotency_key: 'k1', question: true } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'ask him' } })
    await settle(id)
    expect(toolResults(id).at(-1)).toContain(`You have no Grant to message ${chiefId}`)
  })
})

describe('the question flag (gb-l1x1)', () => {
  it('labels the message as a question in the chief\'s Conversation and for the model; the chief answers with robot_reply', async () => {
    const id = await activeRobot()
    const name = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!.identity.name
    scripts.set(chiefId, [
      (request) => {
        // The handle of the question: the Question message names it (the other request's handle is another one).
        const handle = /Question from [^\]]*answer with robot_reply using handle (rh-[0-9a-f-]+)/.exec(JSON.stringify(request.messages))![1]!
        return { calls: [{ name: 'robot_reply', args: { handle, reply: 'We use Acme; invoices go to billing@acme.test.' } }] }
      },
      { text: '' },
    ])
    scripts.set(id, [
      { calls: [{ name: 'robot_send', args: { to: chiefId, request: 'Which supplier do we use?', idempotency_key: 'k1', question: true } }] },
      { calls: [{ name: 'robot_send', args: { to: chiefId, request: 'Please file the invoice.', idempotency_key: 'k2' } }] },
      { text: '' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'find out' } })
    await settle(id)
    await settle(chiefId)
    const received = requests.get(chiefId)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message)))
    expect(received.find((text) => text.includes('Which supplier do we use?'))).toContain(`[Question from \\"${name}\\" (${id}), request `)
    expect(received.find((text) => text.includes('Please file the invoice.'))).toContain(`[Robot message from \\"${name}\\" (${id}), request `)
    const items = await chat(chiefId)
    expect(items.flatMap((item) => (item.kind === 'message' && item.sender.kind === 'robot' ? [[item.text, item.question ?? false]] : []))).toEqual([['Which supplier do we use?', true], ['Please file the invoice.', false]])
    // The answer comes back as a reply in the asking Robot's Conversation.
    await vi.waitFor(async () => {
      await settle(id)
      expect((await chat(id)).some((item) => item.kind === 'message' && item.sender.kind === 'robot' && item.text.includes('billing@acme.test'))).toBe(true)
    }, { timeout: 10_000 })
  })
})

describe('need_help is gone (gb-c0ub)', () => {
  const GONE = ['need_help', 'help_requests', 'help_answer']

  it('no composition has its tools: an ordinary Robot, in setup or active, and Mr. Robot', async () => {
    const setup = await newRobot()
    expect(await env.ROBOT.getByName(setup).toolNames()).not.toEqual(expect.arrayContaining(GONE.slice(0, 1)))
    await testRobot(setup).activateForTest()
    for (const id of [setup, chiefId]) {
      const names = await env.ROBOT.getByName(id).toolNames()
      for (const gone of GONE) expect(names).not.toContain(gone)
    }
    expect(await env.ROBOT.getByName(chiefId).toolNames()).toEqual(expect.arrayContaining(['robot_list', 'robot_conversation', 'robot_file_read']))
  })

  it('an open help Ask from before still takes the owner\'s answer and wakes the Robot; nothing escalates it to Mr. Robot', async () => {
    const id = await activeRobot()
    const askId = await testRobot(id).helpFromBeforeForTest('The VAT number of the new company')
    const open = (await chat(id)).flatMap((item) => (item.kind === 'proposal' ? [item.proposal] : [])).find((proposal) => proposal.id === askId)!
    expect(open).toMatchObject({ kind: 'help', status: 'open', help: { need: 'The VAT number of the new company', escalated: false } })

    // Hours later the chief has not been woken: no timer is left.
    const before = requests.get(chiefId)?.length ?? 0
    await settle(chiefId)
    expect(requests.get(chiefId)?.length ?? 0).toBe(before)

    scripts.set(id, [{ text: '' }])
    const answered = await api<ProposalView>(ANNA, `/api/robots/${id}/help/${askId}`, { body: { text: 'It is PL 123-45-67-890.' } })
    expect(answered.body).toMatchObject({ id: askId, status: 'done', help: { answeredBy: 'owner', answer: 'It is PL 123-45-67-890.' } })
    await settle(id)
    expect(JSON.stringify(wakeOf(requests.get(id)!.at(-1)!))).toContain(`[Answer to your request ${askId} from `)
    expect((await api(ANNA, `/api/robots/${id}/help/${askId}`, { body: { text: 'again' } })).status).toBe(409)
  })
})
