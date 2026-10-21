/**
 * Connection instructions (v1.15 ticket 08, gb-wzl9, gb-j887, gb-q55x): the owner writes them on a Connection; every Robot
 * granted it reads them in the runtime section of its prompt; Mr. Robot reads and sets them for the owner.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionView, Me, RobotSummary } from '@mr-robot/protocol'
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
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  benId = (await api<Me>(BEN, '/api/me')).body.id
})

async function robotWith(connections: Record<string, 'allow' | 'ask'>): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: [], skills: [], recipients: [], secrets: [], connections } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const runtime = async (id: string) => (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
const instructionsLine = (label: string, text: string) => `- Instructions for ${label}: ${text}`

const slack = () => env.MEMBER.getByName(annaId).addConnection({ kind: 'slack', label: 'Work', account: 'acme', services: [], shared: false, meta: {}, secrets: { token: 'xoxc-1', cookie: 'xoxd-1' } })
const google = () => env.MEMBER.getByName(annaId).addConnection({ kind: 'google', label: 'Private', account: 'anna@gmail.test', services: ['gmail'], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { accessToken: 'a', refreshToken: 'r' } })

describe('Connection instructions in the prompt', () => {
  it('are saved on the Connection and read by a Robot holding it at allow or ask, and by no other', async () => {
    const work = await slack()
    const mail = await google()
    const saved = await api<ConnectionView>(ANNA, `/api/connections/${work.id}`, { method: 'PATCH', body: { instructions: 'Answer in threads. Never mark a channel read.' } })
    expect(saved.status).toBe(200)
    expect(saved.body.instructions).toBe('Answer in threads. Never mark a channel read.')
    const allowed = await robotWith({ [work.id]: 'allow' })
    const asking = await robotWith({ [work.id]: 'ask', [mail.id]: 'allow' })
    const without = await robotWith({ [mail.id]: 'allow' })
    const line = instructionsLine('Work', 'Answer in threads. Never mark a channel read.')
    expect(await runtime(allowed)).toContain(line)
    expect(await runtime(asking)).toContain(line)
    expect(await runtime(without)).not.toContain('Instructions for')
    // The same text reaches the model: it is part of the system prompt of the Turn.
    scripts.set(allowed, [{ text: 'Ok.' }])
    await api(ANNA, `/api/robots/${allowed}/messages`, { body: { text: 'hi' } })
    await settle(allowed)
    expect(JSON.stringify(requests.get(allowed)!.at(-1)!.messages.filter((message) => message.role === 'system'))).toContain(line)
  })

  it('follow a change at once and are gone when cleared', async () => {
    const work = await slack()
    const id = await robotWith({ [work.id]: 'allow' })
    expect(await runtime(id)).not.toContain('Instructions for')
    await api(ANNA, `/api/connections/${work.id}`, { method: 'PATCH', body: { instructions: 'Post in #ops only.' } })
    expect(await runtime(id)).toContain(instructionsLine('Work', 'Post in #ops only.'))
    await api(ANNA, `/api/connections/${work.id}`, { method: 'PATCH', body: { instructions: '' } })
    expect(await runtime(id)).not.toContain('Instructions for')
  })

  it("a Connection shared with the Space carries its owner's instructions to the Robots granted it", async () => {
    const bot = await env.MEMBER.getByName(benId).addConnection({ kind: 'discord', label: 'Bot', account: 'Mr. Robot', services: [], shared: true, meta: {}, secrets: { token: 't' } })
    await api(BEN, `/api/connections/${bot.id}`, { method: 'PATCH', body: { instructions: 'Reply in the channel it came from.' } })
    const id = await robotWith({ [bot.id]: 'allow' })
    expect(await runtime(id)).toContain(instructionsLine('Bot', 'Reply in the channel it came from.'))
  })
})

describe("Mr. Robot's Connection tools", () => {
  async function chief(): Promise<string> {
    const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await settle(id)
    return id
  }
  async function call(id: string, calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<string[]> {
    scripts.set(id, [{ calls }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-calls.length).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
  }

  it('lists the Connections with their instructions, and sets and clears them for his owner (gb-q55x)', async () => {
    const work = await slack()
    const id = await robotWith({ [work.id]: 'allow' })
    const mrRobot = await chief()
    const [listed, set] = await call(mrRobot, [
      { name: 'connection_list', args: {} },
      { name: 'connection_instructions_set', args: { connection_id: work.id, instructions: 'Answer in threads.' } },
    ])
    expect(JSON.parse(listed!).connections).toEqual([expect.objectContaining({ id: work.id, label: 'Work', mine: true, instructions: '' })])
    expect(JSON.parse(set!)).toEqual({ id: work.id, label: 'Work', instructions: 'Answer in threads.' })
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body.find((connection) => connection.id === work.id)!.instructions).toBe('Answer in threads.')
    expect(await runtime(id)).toContain(instructionsLine('Work', 'Answer in threads.'))
    const [cleared] = await call(mrRobot, [{ name: 'connection_instructions_set', args: { connection_id: work.id, instructions: '' } }])
    expect(JSON.parse(cleared!).instructions).toBe('')
    expect(await runtime(id)).not.toContain('Instructions for')
  })

  it("refuses to set the instructions of another Member's shared Connection", async () => {
    const bot = await env.MEMBER.getByName(benId).addConnection({ kind: 'discord', label: 'Bot', account: 'Mr. Robot', services: [], shared: true, meta: {}, secrets: { token: 't' } })
    const mrRobot = await chief()
    const [listed, refused] = await call(mrRobot, [
      { name: 'connection_list', args: {} },
      { name: 'connection_instructions_set', args: { connection_id: bot.id, instructions: 'Mine now.' } },
    ])
    expect(JSON.parse(listed!).connections).toEqual([expect.objectContaining({ id: bot.id, mine: false, owner: 'Ben' })])
    expect(refused).toContain('belongs to Ben')
    expect((await api<ConnectionView[]>(BEN, '/api/connections')).body[0]!.instructions).toBe('')
  })
})
