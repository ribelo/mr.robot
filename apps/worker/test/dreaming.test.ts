/**
 * Dreaming (v1.20 ticket 05, dm-hx44, dm-ox7j, dm-pzxk, dm-alok, dm-4ybd, dm-s11z, dm-vjnv, dm-0ylj, dm-7s7w, dm-buya): at the dream hour a
 * Robot with something to look back at dreams on the dream model, with its inputs, its tools only, one morning question, and its outputs.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Conversation, FileHistoryView, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const DREAMER = { provider: 'stub', model: 'dreamer', effort: 'off' }

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function staff(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['files', 'web'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

async function dreamHour(id: string): Promise<void> {
  await testRobot(id).dreamNowForTest()
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

const write = (path: string, content: string) => ({ name: 'write', args: { on: 'workspace', file_path: path, content } })
const userText = (request: GenerateOptions) => JSON.stringify(request.messages.filter((message) => message.role === 'user'))
const toolTexts = (request: GenerateOptions) => request.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const dreamDate = (request: GenerateOptions) => /dreams\/(\d{4}-\d{2}-\d{2})\.md/.exec(userText(request))![1]!

describe('the dream (dm-hx44, dm-ox7j, dm-pzxk, dm-alok, dm-4ybd, dm-s11z, dm-vjnv)', () => {
  it('dreams on the Space\'s dream model with its inputs and tools, writes its outputs, asks once, and books memory', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultDreamModel: DREAMER } })
    const id = await staff()
    await turn(id, 'I moved to Gdańsk.', [{ calls: [write('memory/2026-10-21.md', '- Anna moved to Gdańsk.\n')] }, { say: 'Noted.' }])
    // The first alarm plans the dream hour: 03:00 in the Robot's zone (UTC here).
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    const planned = await testRobot(id).dreamNowForTest()
    expect(new Date(planned!).getUTCHours()).toBe(3)

    const before = requests.get(id)!.length
    const section = ['## How to act for Anna', ...Array.from({ length: 40 }, (_, line) => `- rule ${line + 1}`)].join('\n')
    scripts.set(id, [
      (request) => ({ calls: [write(`dreams/${dreamDate(request)}.md`, '# Dream\n- Anna moved; update the address next time.\n')] }),
      { calls: [write('AGENTS.md', `# AGENTS.md\n\n${section}\n\n## Tool notes\n- none\n`)] },
      { calls: [{ name: 'say', args: { text: 'Good morning!' } }, { name: 'web_fetch', args: { url: 'https://example.com' } }] },
      { calls: [{ name: 'ask', args: { prompt: 'Shall I update the address?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] } }] },
      { calls: [{ name: 'ask', args: { prompt: 'Shall I update the address?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], dismiss_on_move_on: true } }] },
      { calls: [{ name: 'ask', args: { prompt: 'And the phone?', options: [{ label: 'Yes', value: 'yes' }], dismiss_on_move_on: true } }] },
      { text: '' },
    ])
    await testRobot(id).dreamNowForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const dream = requests.get(id)!.slice(before)
    expect(dream.length).toBeGreaterThanOrEqual(6)
    expect(dream.every((request) => request.model === 'dreamer')).toBe(true)
    const wake = userText(dream[0]!)
    expect(wake).toContain('Dream: it is night')
    expect(wake).toContain('- memory/2026-10-21.md')
    expect(wake).toContain('How to act for Anna')

    const results = toolTexts(dream.at(-1)!).join('\n')
    expect(results).toContain('say is not available during the dream')
    expect(results).toContain('web_fetch is not available during the dream')
    expect(results).toContain('the morning question carries dismiss_on_move_on: true')
    expect(results).toContain('a dream asks at most one question')

    const date = dreamDate(dream[0]!)
    expect((await api<FileHistoryView>(ANNA, `/api/robots/${id}/file/history?path=dreams/${date}.md`)).body.current?.by).toBe('the dream')
    const agents = (await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=AGENTS.md`)).body.text
    expect(agents).toContain('- rule 30\n')
    expect(agents).not.toContain('- rule 31')
    expect(agents).toContain('## Tool notes')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.asks).toHaveLength(1)
    expect(conversation.items.some((item) => item.kind === 'reply' && item.text === 'Good morning!')).toBe(false)
    expect((await testRobot(id).usageBySourceForTest())['memory']).toBeGreaterThan(0)

    // The next Turn is on the Robot's own model again.
    await turn(id, 'hi', [{ say: 'Hi.' }])
    expect(requests.get(id)!.at(-1)!.model).toBe('stub')
  }, 60_000)

  it('is skipped when nothing happened since the last dream, and off when dreaming is off (dm-hx44, dm-buya)', async () => {
    const id = await staff()
    await turn(id, 'note', [{ calls: [write('memory/2026-10-21.md', '- a note\n')] }, { say: 'Noted.' }])
    scripts.set(id, [{ text: '' }])
    await dreamHour(id)
    const after = requests.get(id)!.length
    expect(requests.get(id)!.some((request) => userText(request).includes('Dream: it is night'))).toBe(true)
    // Nothing new: no dream.
    await dreamHour(id)
    expect(requests.get(id)!.length).toBe(after)

    // Dreaming off on the Robot: nothing either, even with a new note.
    await turn(id, 'note two', [{ calls: [write('memory/2026-10-22.md', '- another\n')] }, { say: 'Noted.' }])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { dreaming: false } })
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.settings).toMatchObject({ dreaming: false, dreamModel: null, spaceDreaming: true, spaceDreamModel: null })
    const count = requests.get(id)!.length
    await dreamHour(id)
    expect(requests.get(id)!.length).toBe(count)
    // The Space default off, the Robot following it: nothing.
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { dreaming: null } })
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { defaultDreaming: false } })
    await dreamHour(id)
    expect(requests.get(id)!.length).toBe(count)
  }, 60_000)
})