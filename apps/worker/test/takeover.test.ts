import { abortAllDurableObjects, env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { browserLog, cdpLog } from './stub-browser.ts'
import { requests, scripts } from './stub-llm.ts'
import { delivered } from './worker.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  delivered.clear()
  scripts.clear()
  requests.clear()
  browserLog.length = 0
  cdpLog.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

/** A viewer's WebSocket that collects what the Robot sends. */
async function connect(as: string, id: string) {
  const response = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/ws`, { headers: { upgrade: 'websocket', 'x-dev-identity': as } })
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

async function shopperAtLogin(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, sharing: 'home', grants: { tools: ['browser'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  scripts.set(body.id, [
    { calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] },
    { calls: [{ name: 'browser_request_takeover', args: { reason: 'Please log in to the shop.' } }] },
    { text: 'Waiting for you to log in.' },
  ])
  await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'buy coffee' } })
  await settle(body.id)
  return body.id
}

describe('live view and takeover', () => {
  it('a takeover request suspends the Robot with the browser open (robot-doqx)', async () => {
    const id = await shopperAtLogin()
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.takeover).toEqual({ reason: 'Please log in to the shop.', claimedBy: null })
    expect(panel.summary.fleetState).toBe('waiting for you')
    expect(browserLog).not.toContain('close')
    const owner = (await api<{ id: string }>(ANNA, '/api/me')).body
    const sent = await (env.MEMBER.getByName(owner.id) as unknown as DurableObjectStub<import('./worker.ts').Member>).deliveredForTest()
    expect(sent.find((notification) => notification.tag === `${id}-needs you`)).toMatchObject({ body: 'Please log in to the shop. Tap to take over the browser.' })
    expect((await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.working).toBe(false)
    // A message sent meanwhile waits for the hand-back instead of starting a Turn.
    const before = (requests.get(id) ?? []).length
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'are you done?' } })
    await settle(id)
    expect((requests.get(id) ?? []).length).toBe(before)
  })

  it('reattaches the waiting browser after the Robot restarts', async () => {
    const id = await shopperAtLogin()
    await abortAllDurableObjects()
    const viewer = await connect(ANNA, id)
    await viewer.send({ type: 'live', on: true })
    expect(browserLog).toContain('attach')
    expect(viewer.received.some((message) => message['type'] === 'frame')).toBe(true)
  })

  it('streams the screen to a watcher without taking it over (robot-ksvy)', async () => {
    const id = await shopperAtLogin()
    const viewer = await connect(ANNA, id)
    await viewer.send({ type: 'live', on: true })
    expect(cdpLog.map((entry) => entry.method)).toContain('Page.startScreencast')
    expect(viewer.received.some((message) => message['type'] === 'frame')).toBe(true)
    await viewer.send({ type: 'tap', x: 10, y: 10 })
    expect(viewer.received.at(-1)).toMatchObject({ type: 'error', message: 'claim the browser first' })
  })

  it('only the owner controls it; taps and keys reach the page; handing back resumes the Robot (robot-g6qb, robot-j4ll)', async () => {
    const id = await shopperAtLogin()
    const anna = await connect(ANNA, id)
    const ben = await connect(BEN, id)
    await ben.send({ type: 'claim' })
    expect(ben.received.at(-1)).toMatchObject({ type: 'error', message: 'only the owner takes over this browser' })
    await anna.send({ type: 'claim' })
    expect(anna.received.some((message) => message['type'] === 'claimed')).toBe(true)
    await ben.send({ type: 'tap', x: 1, y: 1 })
    expect(ben.received.at(-1)).toMatchObject({ type: 'error' })

    await anna.send({ type: 'tap', x: 200, y: 300 })
    await anna.send({ type: 'text', text: 'right-password' })
    await anna.send({ type: 'key', key: 'Enter' })
    expect(cdpLog.filter((entry) => entry.method.startsWith('Input.')).map((entry) => entry.method)).toEqual([
      'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent',
    ])

    scripts.set(id, [{ text: 'Thanks, I can continue.' }])
    await anna.send({ type: 'handback' })
    await settle(id)
    const last = JSON.stringify(requests.get(id)!.at(-1)!.messages.at(-1))
    expect(last).toContain('handed the browser back after')
    expect(last).toContain('https://shop.test/login')
    expect(last).toMatch(/screens\/.+\.png/)
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.takeover).toBeNull()
    // The browser stays open while the owner still watches, and closes when they leave (rb-keaw).
    expect(browserLog.at(-1)).not.toBe('close')
    anna.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(browserLog.at(-1)).toBe('close')
    void env
  })

  it('releases a claim when its socket closes, and ends a removed Member\'s view', async () => {
    const id = await shopperAtLogin()
    const anna = await connect(ANNA, id)
    await anna.send({ type: 'claim' })
    anna.socket.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.takeover).toEqual({ reason: 'Please log in to the shop.', claimedBy: null })

    const ben = await connect(BEN, id)
    let closed = false
    ben.socket.addEventListener('close', () => { closed = true })
    const benId = (await api<{ id: string }>(BEN, '/api/me')).body.id
    await api(ANNA, `/api/admin/members/${benId}`, { method: 'DELETE' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(closed).toBe(true)
  })

  it("opens an idle Robot's browser on demand at its last page, and closes it when the viewer leaves (rb-keaw)", async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['browser'], skills: [], recipients: [], secrets: [] } } })
    await testRobot(body.id).activateForTest()
    scripts.set(body.id, [{ calls: [{ name: 'browser_open', args: { url: 'https://shop.test/login' } }] }, { text: 'Seen.' }])
    await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'look' } })
    await settle(body.id)
    expect(browserLog.at(-1)).toBe('close')
    browserLog.length = 0
    cdpLog.length = 0

    const viewer = await connect(ANNA, body.id)
    await viewer.send({ type: 'live', on: true })
    expect(browserLog).toEqual(['open', 'goto:https://shop.test/login'])
    expect(viewer.received.some((message) => message.type === 'frame')).toBe(true)

    // The owner takes the idle browser without being asked; hand-back does not wake the Robot.
    const before = (requests.get(body.id) ?? []).length
    await viewer.send({ type: 'claim' })
    expect(viewer.received.some((message) => message.type === 'claimed')).toBe(true)
    await viewer.send({ type: 'handback' })
    viewer.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await settle(body.id)
    expect(browserLog.at(-1)).toBe('close')
    expect((requests.get(body.id) ?? []).length).toBe(before)
  })
})
