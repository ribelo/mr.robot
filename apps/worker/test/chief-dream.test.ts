/**
 * Mr. Robot as steward (v1.20 ticket 06, dm-pt5b, dm-w15l, dm-kkgy): his dream reads his owner's Robots' daily notes through his deputy
 * reads and proposes a Member-file edit from them; it cannot write into another Robot's files; it merges two people pages of one person.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Conversation, RobotSummary } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { programmed, requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

/** Every v1.20 test runs in code mode first, then with direct tool calls (v1.20.1). */
const MODES = [['code mode', true], ['direct calls', false]] as const
let codeMode = true

afterEach(() => {
  programmed.on = false
})

beforeEach(async () => {
  programmed.on = true
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const call = (name: string, args: Record<string, unknown>) => ({ name, args })
const userText = (request: GenerateOptions) => JSON.stringify(request.messages.filter((message) => message.role === 'user'))
const toolTexts = (request: GenerateOptions) => request.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe.each(MODES)('Mr. Robot\'s dream (dm-pt5b, dm-w15l, dm-kkgy), %s', (_mode, code) => {
  beforeEach(() => {
    codeMode = code
  })

  it("reads a Robot's note, proposes the Member-file edit, cannot write the Robot's files, and merges two pages of one person", async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    const seller = body.id
    await settle(seller)
    await api(ANNA, `/api/robots/${seller}/settings`, { method: 'PATCH', body: { codeMode, identity: { name: 'Seller', title: '', description: 'Sells.', avatarColor: '#8b5cf6' }, grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(seller).activateForTest()
    await turn(seller, 'Anna moved', [{ calls: [
      call('write', { on: 'workspace', file_path: 'memory/2026-10-21.md', content: '- Anna said her new address is Mokotowska 5, Warsaw.\n' }),
      call('write', { on: 'workspace', file_path: 'memory/people/jan-kowalski.md', content: '# Jan Kowalski\n\nRole: customer\n\n## Facts\n- 2026-10-20 Wants a garage.\n' }),
      call('write', { on: 'workspace', file_path: 'memory/people/jan-k.md', content: '# Jan K.\n\nRole: customer\n\n## Facts\n- 2026-10-21 Paid the deposit.\n' }),
    ] }, { say: 'Noted.' }])

    const chief = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await api(ANNA, `/api/robots/${chief}/settings`, { method: 'PATCH', body: { codeMode } })
    const before = (requests.get(chief) ?? []).length
    scripts.set(chief, [
      { calls: [call('robot_file_read', { robot_id: seller, path: 'memory/2026-10-21.md' })] },
      { calls: [call('propose_member_file_edit', { file: 'memory/world.md', content: '# world.md\n\n- Address: Mokotowska 5, Warsaw.\n', purpose: 'Your new address, from Seller\'s note.' })] },
      { calls: [call('robot_file_write', { robot_id: seller, path: 'MEMORY.md', content: 'taken over' }), call('memory_write_shared', { file: 'USER.md', content: 'x' })] },
      { calls: [
        call('write', { on: 'workspace', file_path: 'memory/people/jan-kowalski.md', content: '# Jan Kowalski\n\nRole: customer\n\n## Facts\n- 2026-10-20 Wants a garage.\n- 2026-10-21 Paid the deposit.\n' }),
        call('delete_file', { on: 'workspace', path: 'memory/people/jan-k.md' }),
      ] },
      { text: '' },
    ])
    await testRobot(chief).dreamNowForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(chief))
    await settle(chief)

    const dream = (requests.get(chief) ?? []).slice(before)
    const wake = userText(dream[0]!)
    expect(wake).toContain('Dream: it is night')
    expect(wake).toContain(`Seller (${seller}): memory/2026-10-21.md`)
    expect(wake).toContain('You are the chief')
    const results = toolTexts(dream.at(-1)!).join('\n')
    expect(results).toContain('Mokotowska 5')
    expect(results).toContain('robot_file_write is not available during the dream')
    expect(results).toContain('memory_write_shared is not available during the dream')
    // The proposal waits for the owner.
    const asks = (await api<Conversation>(ANNA, `/api/robots/${chief}/conversation`)).body.asks
    expect((asks ?? []).map((ask) => ask.kind)).toEqual(['member-file'])
    // Seller's files are its own.
    expect((await api<{ text: string }>(ANNA, `/api/robots/${seller}/file?path=MEMORY.md`)).body.text).not.toContain('taken over')
    // One page per person, and INDEX.md says so.
    const index = (await api<{ text: string }>(ANNA, `/api/robots/${seller}/file?path=memory/people/INDEX.md`)).body.text
    expect(index).toContain('[Jan Kowalski](jan-kowalski.md)')
    expect(index).not.toContain('jan-k.md')
    expect((await api(ANNA, `/api/robots/${seller}/file?path=memory/people/jan-k.md`)).status).toBe(404)

    // Another Robot cannot delete a page.
    await turn(seller, 'delete', [{ calls: [call('delete_file', { on: 'workspace', path: 'memory/people/jan-kowalski.md' })] }, { say: 'No.' }])
    expect(toolTexts(requests.get(seller)!.at(-1)!).join('')).toContain('only your owner deletes it, or Mr. Robot')
  }, 60_000)
})