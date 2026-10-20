/**
 * The voice (v1.15 tickets 01 and 02): say is the only way a Robot speaks; assistant text stays in the Trajectory; a Turn that ends
 * without a say gets one step to speak, then (for the owner's Turns) a fallback reply; an owner Turn quiet for ten minutes gets a steer.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelOutput } from '../src/channels/channel.ts'
import type { Conversation, ConnectionView, Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { connectorFixtures, type RecordedCall } from './connector-fixtures.ts'
import { fakeOutbox } from './fake-channel.ts'
import { requests, scripts, stepRequests, stepScripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const API = 'https://discord.com/api/v10'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  stepScripts.clear()
  stepRequests.clear()
  fakeOutbox.length = 0
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

afterEach(() => connectorFixtures.reset())

const sayCall = (text: string, extra: Record<string, unknown> = {}) => ({ name: 'say', args: { text, ...extra } })

async function activeRobot(settings: Record<string, unknown> = {}): Promise<string> {
  // The setup greeting is no part of what these tests read.
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['files', 'tasks', 'subagents'], skills: [], recipients: [], secrets: [] }, ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  stepRequests.delete(body.id)
  return body.id
}

async function owner(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const chat = async (id: string) => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
const replies = async (id: string) => (await chat(id)).flatMap((item) => (item.kind === 'reply' ? [item] : []))
const eventsOf = async (id: string) => env.ROBOT.getByName(id).trajectory()
const toolResults = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))

describe('say is the Robot\'s voice (gb-s81e, gb-6c8d, gb-wma6, gb-25jb)', () => {
  it('shows each say as its own reply at once, and no assistant text as one; the text stays in the Trajectory', async () => {
    const id = await activeRobot()
    await owner(id, 'find me a flat', [
      { text: 'Let me think about it.', calls: [sayCall('Starting the search.')] },
      { calls: [sayCall('Two flats match.')] },
      { text: 'Internal wrap-up.' },
    ])
    const found = await replies(id)
    expect(found.map((item) => item.text)).toEqual(['Starting the search.', 'Two flats match.'])
    expect(found.every((item) => item.fallback === undefined)).toBe(true)
    const events = await eventsOf(id)
    expect(events.some((event) => event.type === 'assistant/message' && event.data.includes('Let me think about it.'))).toBe(true)
    expect(events.some((event) => event.type === 'assistant/message' && event.data.includes('Internal wrap-up.'))).toBe(true)
    // The Robot spoke: the platform has nothing to add.
    expect(stepRequests.get(id)).toBeUndefined()
  })

  it('works from a code-mode program: several messages at the right moments of one step (gb-25jb)', async () => {
    const id = await activeRobot({ codeMode: true })
    const program = [
      "await tools.say({ text: 'Starting.' })",
      "const text = await tools.read({ file_path: 'SOUL.md' })",
      "await tools.say({ text: 'Read ' + String(text).length + ' characters.' })",
      "return 'done'",
    ].join('\n')
    await owner(id, 'go', [{ calls: [{ name: 'run_code', args: { code: program, description: 'say, read, say' } }] }, { text: '' }])
    const found = await replies(id)
    expect(found.map((item) => item.text)).toEqual(['Starting.', expect.stringMatching(/^Read \d+ characters\.$/)])
    // Both are in the log before the program's result.
    const types = (await eventsOf(id)).map((event) => event.type)
    const records = types.flatMap((type, index) => (type === 'plugin:mr-robot/say' ? [index] : []))
    expect(records).toHaveLength(2)
    expect(records.at(-1)!).toBeLessThan(types.lastIndexOf('tool/result'))
  })

  it('hands over a Workspace file and a stored screenshot by reference; a missing one fails the call and shows nothing (gb-4wgm)', async () => {
    const id = await activeRobot({ grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } })
    const screen = await testRobot(id).saveScreenForTest()
    await owner(id, 'show me', [
      { calls: [{ name: 'write', args: { file_path: 'out/note.txt', content: 'hello report' } }] },
      { calls: [sayCall('The note and the page.', { attachments: ['out/note.txt', `screen:${screen}`] })] },
      { calls: [sayCall('Another.', { attachments: ['out/missing.txt'] }), sayCall('Wrong id.', { attachments: ['screen:nope.png'] }), sayCall('Platform file.', { attachments: ['docs/robots.md'] })] },
      { text: '' },
    ])
    const found = await replies(id)
    expect(found.map((item) => item.text)).toEqual(['The note and the page.'])
    expect(found[0]!.attachments).toEqual([
      { name: 'note.txt', path: 'out/note.txt', size: 12, contentType: 'text/plain; charset=utf-8' },
      { name: screen, path: `screen:${screen}`, size: 26, contentType: 'image/png' },
    ])
    const [missing, wrongId, platform] = toolResults(id).slice(-3)
    expect(missing).toContain('no file "out/missing.txt" in your Workspace')
    expect(wrongId).toContain('no screenshot "screen:nope.png"')
    expect(platform).toContain('is not a file of your Workspace')
  })

  it('a Subagent has no say (gb-bdwb)', async () => {
    const id = await activeRobot({ subagentModels: [{ provider: 'stub', model: 'stub' }] })
    scripts.set(`${id}:sub`, [{ text: 'Looked.' }])
    await owner(id, 'delegate', [{ calls: [{ name: 'subagent', args: { description: 'Look', prompt: 'Look at it.' } }] }, { say: 'Started.' }])
    await vi.waitFor(() => expect(requests.get(`${id}:sub`)?.length ?? 0).toBeGreaterThan(0), { timeout: 10_000 })
    const offered = (requests.get(`${id}:sub`)?.[0]?.tools ?? []).map((definition) => definition.name)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered).not.toContain('say')
  })
})

describe('every say goes out on the Channel the Wake-up came from (gb-s6lx, gb-jdzo)', () => {
  it('sends each say at once with its files, to the Channel that asked, and keeps the app\'s own Turns in the app', async () => {
    const id = await activeRobot({ notifications: { enabled: true, members: [], channels: ['fake'] } })
    scripts.set(id, [{ calls: [sayCall('Looking.')] }, { calls: [sayCall('Found it.')] }, { text: '' }])
    const route = { channel: 'fake', address: 'thread-9' }
    expect(await testRobot(id).channelEvent({ channel: 'fake', eventId: 'e1', from: 'ola', text: 'any news?', route })).toEqual({ accepted: true })
    await settle(id)
    const sent = fakeOutbox.filter((output): output is Extract<ChannelOutput, { kind: 'reply' }> => output.kind === 'reply')
    expect(sent.map((output) => [output.text, output.route])).toEqual([['Looking.', route], ['Found it.', route]])
    expect(sent.every((output) => output.attachments.length === 0)).toBe(true)

    fakeOutbox.length = 0
    await owner(id, 'and in the app?', [{ say: 'Only here.' }])
    // The app's own Turn answers in the app; the Channels that hear everything also get it, with no route.
    expect(fakeOutbox.filter((output) => output.kind === 'reply').map((output) => output.kind === 'reply' ? [output.text, output.route] : [])).toEqual([['Only here.', null]])
  })

  it('a say names a Discord channel the owner enabled; any other is refused (gb-jdzo)', async () => {
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, (call: RecordedCall) => ({ id: 'M-out', channel_id: 'C-robot', content: (JSON.parse(call.body ?? '{}') as { content?: string }).content ?? '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } }))
    const id = await activeRobot({ discordChannel: 'C-robot', discordProactive: false })
    connectorFixtures.calls = []
    await api(ANNA, '/api/tasks', { body: { title: 'Check', instructions: 'Look.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } } })
    scripts.set(id, [{ calls: [sayCall('Posted on the channel.', { channel: 'C-robot' })] }, { calls: [sayCall('Elsewhere.', { channel: 'C-other' })] }, { text: '' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const posts = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url.startsWith(`${API}/channels/`))
    expect(posts.map((call) => [call.url, (JSON.parse(call.body ?? '{}') as { content: string }).content])).toEqual([[`${API}/channels/C-robot/messages`, 'Posted on the channel.']])
    expect(toolResults(id).at(-1)).toContain('you may speak on your Discord channel (C-robot)')
    expect((await replies(id)).map((item) => item.text)).toEqual(['Posted on the channel.'])
  })

  it('Discord gets a small file with the message and a link into the app for a big one (gb-s6lx)', async () => {
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    const id = await activeRobot({ discordChannel: 'C-robot', grants: { tools: ['files'], skills: [], recipients: [], secrets: [] } })
    await env.FILES.put(`robots/${id}/out/note.txt`, 'hello report')
    await env.FILES.put(`robots/${id}/out/big.bin`, new Uint8Array(8 * 1024 * 1024 + 1))
    connectorFixtures.calls = []
    scripts.set(id, [{ calls: [sayCall('Here are both.', { attachments: ['out/note.txt', 'out/big.bin'] })] }, { text: '' }])
    const message = { id: 'M-in', channelId: 'C-robot', guildId: 'G-1', authorId: 'U-x', authorName: 'Someone', text: 'send the report', direct: false }
    expect(await env.HOME.getByName('home').discordReceived(message, annaId)).toBe(id)
    await settle(id)
    const [post] = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/C-robot/messages`)
    expect(post!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(post!.body).toContain('filename="note.txt"')
    expect(post!.body).toContain('hello report')
    expect(post!.body).not.toContain('filename="big.bin"')
    expect(post!.body).toContain(`big.bin: https://mr-robot.test/#/r/${id}/files/out/big.bin`)
    expect(post!.body).toContain('"message_reference"')
  })
})

describe('a Robot from before v1.15 keeps its replies (gb-psyl)', () => {
  it('shows assistant text before the upgrade marker as replies and only what is said after it', async () => {
    const id = await activeRobot()
    // The Robot's Turn is a Task's: nobody asked, so its assistant text is no reply and no fallback is made.
    scripts.set(id, [{ text: 'An old reply.' }])
    await testRobot(id).wake({ kind: 'platform', sender: { kind: 'platform' }, text: 'Do something.', payload: { summary: 'Something' } })
    await settle(id)
    expect((await replies(id)).map((item) => item.text)).toEqual([])
    // The upgrade marks where the Conversation had no say: what the Robot wrote until then was its reply.
    await testRobot(id).upgradeVoiceForTest()
    expect((await replies(id)).map((item) => item.text)).toEqual(['An old reply.'])
    await owner(id, 'again', [{ text: 'Hidden now.', calls: [sayCall('Shown.')] }, { text: '' }])
    expect((await replies(id)).map((item) => item.text)).toEqual(['An old reply.', 'Shown.'])
    // The search follows the same rule.
    const hits = await env.ROBOT.getByName(id).searchConversation('reply')
    expect(hits.items.map((hit) => hit.snippet)).toEqual(['An old reply.'])
  })
})

describe('the safety net (gb-xgd7, gb-7jqy, gb-3gp2)', () => {
  it('gives an owner Turn without a say one step; a say in it ends it without a fallback', async () => {
    const id = await activeRobot()
    stepScripts.set(id, [{ say: 'Here you go: 42.' }])
    await owner(id, 'what is the answer?', [{ text: 'The answer is 42.' }])
    expect(stepRequests.get(id)).toHaveLength(1)
    expect(JSON.stringify(stepRequests.get(id)![0]!.messages.at(-1))).toContain('You ended your Turn without saying anything to Anna')
    const found = await replies(id)
    expect(found.map((item) => [item.text, item.fallback])).toEqual([['Here you go: 42.', undefined]])
    expect((await eventsOf(id)).some((event) => event.type === 'plugin:mr-robot/say' && event.data.includes('"fallback":true'))).toBe(false)
  })

  it('shows the last assistant text as the reply, marked a fallback, when the step stays silent', async () => {
    const id = await activeRobot()
    await owner(id, 'what is the answer?', [{ text: 'Thinking.', calls: [{ name: 'my_capabilities', args: {} }] }, { text: 'The answer is 42.' }])
    expect(stepRequests.get(id)).toHaveLength(1)
    const found = await replies(id)
    expect(found.map((item) => [item.text, item.fallback])).toEqual([['The answer is 42.', true]])
    // The Trajectory has the record and the Conversation shows it like any reply; one push says it finished.
    const record = (await eventsOf(id)).find((event) => event.type === 'plugin:mr-robot/say')!
    expect(JSON.parse(record.data)).toMatchObject({ text: 'The answer is 42.', fallback: true })
  })

  it('sends nothing when the Turn wrote no text at all', async () => {
    const id = await activeRobot()
    await owner(id, 'hm', [{ calls: [{ name: 'my_capabilities', args: {} }] }, { text: '' }])
    expect(stepRequests.get(id)).toHaveLength(1)
    expect(await replies(id)).toEqual([])
  })

  it('sends the fallback to the Channel an owner message came from', async () => {
    const id = await activeRobot({ notifications: { enabled: true, members: [], channels: ['pwa'] } })
    await env.MEMBER.getByName(annaId).addConnection({ kind: 'discord-user', label: 'anna', account: 'anna', services: [], shared: false, meta: { userId: 'u-anna' }, secrets: { token: 't' } })
    connectorFixtures.on('GET', `${API}/users/@me`, { id: 'B1', username: 'mr-robot', global_name: 'Mr. Robot', bot: true })
    await api<ConnectionView>(ANNA, '/api/connections/discord', { body: { shared: false, values: { token: 'bot-token-123' } } })
    connectorFixtures.on('POST', `${API}/channels/C-robot/messages`, { id: 'M-out', channel_id: 'C-robot', content: '', timestamp: '2026-10-20T10:00:00Z', author: { id: 'B1', username: 'mr-robot', bot: true } })
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { discordChannel: 'C-robot' } })
    connectorFixtures.calls = []
    scripts.set(id, [{ text: 'It is still free.' }])
    await env.HOME.getByName('home').discordReceived({ id: 'M-ask', channelId: 'C-robot', guildId: 'G-1', authorId: 'u-anna', authorName: 'Anna', text: 'is the flat free?', direct: false }, annaId)
    await settle(id)
    const posts = connectorFixtures.calls.filter((call) => call.method === 'POST' && call.url === `${API}/channels/C-robot/messages`).map((call) => JSON.parse(call.body ?? '{}') as Record<string, unknown>)
    expect(posts).toEqual([{ content: 'It is still free.', message_reference: { message_id: 'M-ask', channel_id: 'C-robot', fail_if_not_exists: false } }])
    expect((await replies(id)).map((item) => [item.text, item.fallback])).toEqual([['It is still free.', true]])
  })

  it('gives a Task Turn without a say the step and never the fallback', async () => {
    const id = await activeRobot()
    await api(ANNA, '/api/tasks', { body: { title: 'Check', instructions: 'Look at the listings.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } } })
    scripts.set(id, [{ text: 'Nothing new.' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    expect(stepRequests.get(id)).toHaveLength(1)
    expect(await replies(id)).toEqual([])
    expect((await eventsOf(id)).some((event) => event.type === 'plugin:mr-robot/say')).toBe(false)
  })
})

describe('the ten-minute steer (gb-0skq)', () => {
  const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve }); return { promise, open } }
  const working = async (id: string, calls: number) => { for (let attempt = 0; attempt < 300 && (requests.get(id)?.length ?? 0) < calls; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20)) }

  it('steers an owner Turn that has said nothing for ten minutes, once', async () => {
    const id = await activeRobot()
    const wait = gate()
    scripts.set(id, [{ gate: wait.promise, then: { calls: [{ name: 'my_capabilities', args: {} }] } }, { calls: [{ name: 'my_capabilities', args: {} }] }, { say: 'Still on it.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'long job' } })
    await working(id, 1)
    expect(await testRobot(id).quietDueForTest()).toBe(true)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    expect(await testRobot(id).quietDueForTest()).toBe(false)
    wait.open()
    await settle(id)
    const second = JSON.stringify(requests.get(id)![1]!.messages)
    expect(second).toContain('Anna has heard nothing from you for 10 minutes')
    // Once: the steer is in the history of the later requests, and nothing else of the kind was added.
    expect(JSON.stringify(requests.get(id)!.at(-1)!.messages).split('has heard nothing').length - 1).toBe(1)
    expect((await replies(id)).map((item) => item.text)).toEqual(['Still on it.'])
  })

  it('does not steer once the Robot has said something', async () => {
    const id = await activeRobot()
    const wait = gate()
    scripts.set(id, [{ calls: [sayCall('On it.')] }, { gate: wait.promise, then: { text: '' } }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'long job' } })
    await working(id, 2)
    expect(await testRobot(id).quietDueForTest()).toBe(false)
    wait.open()
    await settle(id)
    expect(JSON.stringify(requests.get(id))).not.toContain('has heard nothing')
  })
})
