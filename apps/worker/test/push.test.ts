import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'
import { delivered, type Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
const realFetch = globalThis.fetch
let pushes: string[] = []

beforeEach(async () => {
  await reset()
  scripts.clear()
  delivered.clear()
  pushes = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('https://push.example/')) {
      pushes.push(url)
      return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 })
    }
    return realFetch(input, init)
  }) as typeof fetch
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function device(name: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return { endpoint: `https://push.example/${name}`, keys: { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) }, device: name }
}

const anna = async () => (await api<Me>(ANNA, '/api/me')).body
const member = async () => env.MEMBER.getByName((await anna()).id) as unknown as DurableObjectStub<TestMember>

async function activeRobot(tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  delivered.clear()
  pushes = []
  return body.id
}

describe('Web Push', () => {
  it('stores a subscription per device and removes it on unsubscribe (robot-ajrp)', async () => {
    await api(ANNA, '/api/push/subscriptions', { body: await device('phone') })
    await api(ANNA, '/api/push/subscriptions', { body: await device('laptop') })
    expect((await (await member()).pushDevices()).map((entry) => entry.device)).toEqual(['phone', 'laptop'])
    await api(ANNA, '/api/push/subscriptions', { method: 'DELETE', body: { endpoint: 'https://push.example/phone' } })
    expect((await (await member()).pushDevices()).map((entry) => entry.device)).toEqual(['laptop'])
  })

  it('sends one push per event kind with a deep link to the Conversation (robot-9xoj)', async () => {
    await api(ANNA, '/api/push/subscriptions', { body: await device('phone') })
    const id = await activeRobot(['routines'])

    scripts.set(id, [
      { calls: [{ name: 'propose_grants', args: { purpose: 'Read web pages', tools: ['web'] } }] },
      { text: 'I asked for web access.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'watch the shop' } })
    await settle(id)
    await testRobot(id).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Check' }, text: 'Check the shop.' })
    scripts.set(id, [{ text: 'Shop checked: nothing new.' }])
    await settle(id)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { model: { provider: 'missing-provider', model: 'x', effort: 'off' } } })
    await testRobot(id).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Check' }, text: 'again' })
    await settle(id)

    const sent = await (await member()).deliveredForTest()
    const kinds = sent.map((notification) => notification.tag.split('-').at(-1))
    expect(sent.find((notification) => notification.title.endsWith('needs you'))).toMatchObject({ url: `/#/r/${id}` })
    expect(sent.filter((notification) => notification.tag === `${id}-finished`).map((notification) => notification.body)).toContain('Shop checked: nothing new.')
    expect(sent.find((notification) => notification.title.endsWith('is blocked'))).toMatchObject({ url: `/#/r/${id}` })
    expect(kinds.length).toBe(pushes.length)
    expect(new Set(sent.map((notification) => notification.url))).toEqual(new Set([`/#/r/${id}`]))
  })

  it('sends nothing for a Robot with notifications off (robot-r2uz)', async () => {
    await api(ANNA, '/api/push/subscriptions', { body: await device('phone') })
    const id = await activeRobot()
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { notifications: { enabled: false, members: [], channels: ['pwa'] } } })
    await testRobot(id).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Check' }, text: 'Check.' })
    scripts.set(id, [{ text: 'Checked.' }])
    await settle(id)
    expect(await (await member()).deliveredForTest()).toEqual([])
    expect(pushes).toEqual([])
  })

  it('holds a notification inside quiet hours and delivers it when they end (robot-bden)', async () => {
    await api(ANNA, '/api/push/subscriptions', { body: await device('phone') })
    const now = new Date()
    const fmt = (offset: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now.getTime() + offset)
    const id = await activeRobot()
    await api(ANNA, '/api/me', { method: 'PATCH', body: { quietHours: { start: fmt(-3_600_000), end: fmt(3_600_000) } } })
    await testRobot(id).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Night' }, text: 'Night check.' })
    scripts.set(id, [{ text: 'All quiet.' }])
    await settle(id)
    expect(await (await member()).deliveredForTest()).toEqual([])
    const stub = await member()
    await stub.endQuietHoursForTest()
    await runDurableObjectAlarm(env.MEMBER.getByName((await anna()).id))
    expect((await stub.deliveredForTest()).map((notification) => notification.body)).toEqual(['All quiet.'])
    expect(pushes).toEqual(['https://push.example/phone'])
  })

  it('drops a device the push service no longer knows', async () => {
    await api(ANNA, '/api/push/subscriptions', { body: await device('gone') })
    const id = await activeRobot()
    await testRobot(id).wake({ kind: 'routine', sender: { kind: 'routine', routineId: 'rt-1', name: 'Check' }, text: 'Check.' })
    scripts.set(id, [{ text: 'Checked.' }])
    await settle(id)
    expect(await (await member()).pushDevices()).toEqual([])
    void (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`))
  })
})