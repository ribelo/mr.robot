import { env, reset, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionView, Conversation, Me, RobotPanel, RobotSummary, SessionCapture } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { browserLog, cdpLog, signIns } from './stub-browser.ts'
import { requests, scripts } from './stub-llm.ts'
import { connectorFixtures } from './connector-fixtures.ts'

// v1.12 ticket 11: connect Slack or Discord as you from the PWA by signing in under a Takeover of
// Mr. Robot's browser (ux-8pek, ux-wgok, ux-j7m1).
const ANNA = 'anna@example.com'
const TOKEN = 'xoxc-captured-token'
const COOKIE = 'xoxd-captured-cookie'
const DISCORD_TOKEN = 'user-token-captured'
let chief = ''

beforeEach(async () => {
  await reset()
  connectorFixtures.reset()
  scripts.clear()
  requests.clear()
  browserLog.length = 0
  cdpLog.length = 0
  signIns.clear()
  scripts.set('*', [{ text: 'Hello.' }])
  await stubModels()
  await api(ANNA, '/api/me')
  chief = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(chief)
})

/** The Takeover window's socket: claim, tap, hand back. */
async function takeover(id: string) {
  const response = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/ws`, { headers: { upgrade: 'websocket', 'x-dev-identity': ANNA } })
  const socket = response.webSocket!
  socket.accept()
  const received: Array<Record<string, unknown>> = []
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string' && event.data !== 'pong') received.push(JSON.parse(event.data) as Record<string, unknown>)
  })
  const send = async (message: unknown) => {
    socket.send(JSON.stringify(message))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return { socket, received, send }
}

const capture = async (kind: string) => (await api<SessionCapture>(ANNA, `/api/connections/${kind}/browser`)).body

describe('connecting as you through Mr. Robot\'s browser', () => {
  it('Slack: the sign-in page opens under Takeover; hand-back connects the session and leaves none in the browser state', async () => {
    connectorFixtures.on('POST', 'https://slack.com/api/auth.test', { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'anna', team_id: 'T1', user_id: 'U1' })
    // The Robot's own browser state: a shop login it keeps, and an older Slack session.
    await testRobot(chief).seedBrowserStateForTest({
      cookies: [{ name: 'session', value: 'ok', domain: 'shop.test' }, { name: 'd', value: 'xoxd-older', domain: '.slack.com' }],
      storage: { 'https://shop.test': { cart: '1' }, 'https://app.slack.com': { localConfig_v2: '{}' } },
    })
    signIns.set('https://slack.com/signin', {
      url: 'https://app.slack.com/client/T1/C1',
      cookies: [{ name: 'd', value: COOKIE, domain: '.slack.com' }, { name: 'd-s', value: '1', domain: '.slack.com' }],
      storage: { 'https://app.slack.com': { localConfig_v2: JSON.stringify({ teams: { T1: { token: TOKEN } } }) } },
    })

    const started = await api<{ robotId: string; robotName: string }>(ANNA, '/api/connections/slack/browser-start', { body: {} })
    expect(started.status).toBe(200)
    expect(started.body).toEqual({ robotId: chief, robotName: expect.any(String) })
    expect(browserLog).toContain('goto:https://slack.com/signin')
    expect(await capture('slack')).toMatchObject({ state: 'waiting', kind: 'slack' })
    expect((await api<RobotPanel>(ANNA, `/api/robots/${chief}/panel`)).body.takeover).toEqual({ reason: 'Sign in to Slack', claimedBy: null })
    const before = (requests.get(chief) ?? []).length

    const viewer = await takeover(chief)
    await viewer.send({ type: 'live', on: true })
    await viewer.send({ type: 'claim' })
    await vi.waitFor(() => expect(viewer.received.some((message) => message['type'] === 'claimed')).toBe(true))
    await viewer.send({ type: 'tap', x: 10, y: 10 })
    await viewer.send({ type: 'handback' })

    await vi.waitFor(async () => expect(await capture('slack')).toEqual({ state: 'connected', kind: 'slack', account: 'acme.slack.com' }))
    const connections = (await api<ConnectionView[]>(ANNA, '/api/connections')).body
    expect(connections).toEqual([expect.objectContaining({ kind: 'slack', account: 'acme.slack.com', shared: false, status: 'connected' })])
    const me = (await api<Me>(ANNA, '/api/me')).body
    expect((await env.MEMBER.getByName(me.id).useConnection(connections[0]!.id))!.secrets).toEqual({ token: TOKEN, cookie: COOKIE })
    expect(connectorFixtures.calls.find((call) => call.url.endsWith('/auth.test'))!.headers['cookie']).toBe('d=' + COOKIE)

    // The tab is gone with its Slack cookies and storage; the Robot keeps only what is not Slack's.
    expect(browserLog).toEqual(expect.arrayContaining(['read:slack.com', 'forget:slack.com', 'close']))
    const state = await testRobot(chief).browserStateForTest()
    expect(state).toEqual({ cookies: [{ name: 'session', value: 'ok', domain: 'shop.test' }], storage: { 'https://shop.test': { cart: '1' } } })
    expect(JSON.stringify(state)).not.toContain(TOKEN)
    expect(JSON.stringify(state)).not.toContain(COOKIE)
    expect((await api<RobotPanel>(ANNA, `/api/robots/${chief}/panel`)).body.takeover).toBeNull()
    // Mr. Robot was not woken and saw nothing of the session.
    await settle(chief)
    expect((requests.get(chief) ?? []).length).toBe(before)
    const conversation = JSON.stringify((await api<Conversation>(ANNA, `/api/robots/${chief}/conversation`)).body)
    expect(conversation).not.toContain(TOKEN)
    expect(conversation).not.toContain(COOKIE)
    viewer.socket.close()
  })

  it('Discord as you: the page ending the attempt reads the token from localStorage and connects it', async () => {
    connectorFixtures.on('GET', 'https://discord.com/api/v9/users/@me', { id: '111', username: 'anna_n', global_name: 'Anna' })
    signIns.set('https://discord.com/login', {
      url: 'https://discord.com/channels/@me',
      cookies: [{ name: '__dcfduid', value: 'x', domain: 'discord.com' }],
      storage: { 'https://discord.com': { token: JSON.stringify(DISCORD_TOKEN) } },
    })
    expect((await api(ANNA, '/api/connections/discord-user/browser-start', { body: {} })).status).toBe(200)
    const viewer = await takeover(chief)
    await viewer.send({ type: 'claim' })
    await viewer.send({ type: 'tap', x: 10, y: 10 })
    // The page's Takeover closes without "Hand back": the page ends the attempt itself.
    const ended = await api<SessionCapture>(ANNA, '/api/connections/discord-user/browser-end', { body: {} })
    expect(ended.body).toEqual({ state: 'connected', kind: 'discord-user', account: 'anna_n' })
    expect(connectorFixtures.calls.find((call) => call.url.endsWith('/users/@me'))!.headers['authorization']).toBe(DISCORD_TOKEN)
    expect(JSON.stringify(await testRobot(chief).browserStateForTest())).not.toContain(DISCORD_TOKEN)
    expect(await capture('slack')).toEqual({ state: 'none' })
    viewer.socket.close()
  })

  it('ten minutes without a session end the attempt, connect nothing, and say so (ux-wgok)', async () => {
    expect((await api(ANNA, '/api/connections/slack/browser-start', { body: {} })).status).toBe(200)
    expect(await testRobot(chief).alarmForTest()).not.toBeNull()
    await testRobot(chief).signInDueForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(chief))
    expect(await capture('slack')).toEqual({ state: 'timedOut', kind: 'slack' })
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])
    expect((await api<RobotPanel>(ANNA, `/api/robots/${chief}/panel`)).body.takeover).toBeNull()
    expect(browserLog).toEqual(expect.arrayContaining(['forget:slack.com', 'close']))
  })

  it('handing back before signing in connects nothing; a connector without a sign-in has no browser way', async () => {
    expect((await api(ANNA, '/api/connections/slack/browser-start', { body: {} })).status).toBe(200)
    const viewer = await takeover(chief)
    await viewer.send({ type: 'claim' })
    await viewer.send({ type: 'handback' })
    await vi.waitFor(async () => expect(await capture('slack')).toEqual({ state: 'failed', kind: 'slack', message: 'no signed-in Slack session was found in the browser' }))
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])
    expect((await api<{ error: string }>(ANNA, '/api/connections/discord/browser-start', { body: {} })).status).toBe(404)
    viewer.socket.close()
  })
})
