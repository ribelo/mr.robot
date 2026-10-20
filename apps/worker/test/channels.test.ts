import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, RobotPanel } from '@mr-robot/protocol'
import { recipientsOf } from '../src/channels/channel.ts'
import { PwaChannel } from '../src/channels/pwa.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { describeChannelContract } from './channel-contract.ts'
import { FakeChannel, fakeOutbox } from './fake-channel.ts'
import { scripts } from './stub-llm.ts'

const pushes: unknown[] = []
describeChannelContract('PWA', () => new PwaChannel({ notify: async (memberId, event) => pushes.push({ memberId, event }) }), () => pushes.length)
describeChannelContract('fake chat', () => new FakeChannel(), () => fakeOutbox.length)

const ANNA = 'anna@example.com'

describe('Who receives an output (recipientsOf)', () => {
  const reply = { kind: 'reply', id: 'r1', robotId: 'r', robotName: 'R', text: 'x', attachments: [], route: null, unprompted: false } as const
  const note = { kind: 'notification', id: 'n1', robotId: 'r', robotName: 'R', notification: 'blocked', text: 'x', memberIds: [], replyCopy: false } as const
  const discord = { channel: 'discord', address: 'C-1', messageId: 'M-1' }

  it('sends every reply back to where the question came from', () => {
    expect(recipientsOf({ ...reply, route: discord }, ['pwa'], ['discord'])).toEqual(['pwa', 'discord'])
    expect(recipientsOf({ ...reply, id: 'r2', route: discord }, ['pwa'], [])).toEqual(['pwa', 'discord'])
  })

  it('keeps an answer to the app in the app', () => {
    expect(recipientsOf(reply, ['pwa'], ['discord'])).toEqual(['pwa'])
  })

  it('sends every reply of an unprompted Turn to the opted-in Channels only', () => {
    expect(recipientsOf({ ...reply, unprompted: true }, ['pwa'], ['discord'])).toEqual(['pwa', 'discord'])
    expect(recipientsOf({ ...reply, unprompted: true }, ['pwa'], [])).toEqual(['pwa'])
  })

  it('sends notifications to the opted-in Channels, except a copy of the reply', () => {
    expect(recipientsOf(note, ['pwa'], ['discord'])).toEqual(['pwa', 'discord'])
    expect(recipientsOf({ ...note, notification: 'finished', replyCopy: true }, ['pwa'], ['discord'])).toEqual(['pwa'])
    expect(recipientsOf({ ...note, notification: 'finished' }, ['pwa'], ['discord'])).toEqual(['pwa', 'discord'])
  })
})

describe('Channels on a Robot', () => {
  beforeEach(async () => {
    await reset()
    scripts.clear()
    fakeOutbox.length = 0
    await stubModels()
    await api(ANNA, '/api/me')
  })

  async function robot(channels: string[]): Promise<string> {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, notifications: { enabled: true, members: [], channels } } })
    await testRobot(body.id).activateForTest()
    fakeOutbox.length = 0
    return body.id
  }

  it('lists the enabled Channels in the Robot settings; the PWA is always on', async () => {
    const id = await robot(['fake'])
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.settings.notifications.channels).toEqual(['pwa', 'fake'])
  })

  it('wakes the Robot from a Channel event and returns the reply there (robot-vfqd)', async () => {
    const id = await robot(['fake'])
    scripts.set(id, [{ say: 'Hi from the Robot.' }])
    const route = { channel: 'fake', address: 'thread-9' }
    expect(await testRobot(id).channelEvent({ channel: 'fake', eventId: 'e1', from: 'ola', text: 'hi robot', route })).toEqual({ accepted: true })
    expect(await testRobot(id).channelEvent({ channel: 'fake', eventId: 'e1', from: 'ola', text: 'hi robot', route })).toEqual({ accepted: true })
    await settle(id)
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.filter((item) => item.kind === 'message')).toEqual([expect.objectContaining({ text: 'hi robot', sender: { kind: 'channel', channel: 'fake', from: 'ola' } })])
    expect(fakeOutbox.filter((output) => output.kind === 'reply')).toEqual([expect.objectContaining({ text: 'Hi from the Robot.', route })])
  })

  it('sends PWA chat replies to an enabled Channel too, and ignores a disabled one', async () => {
    const id = await robot([])
    scripts.set(id, [{ text: 'Only in the app.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hi' } })
    await settle(id)
    expect(fakeOutbox).toEqual([])
    expect(await testRobot(id).channelEvent({ channel: 'fake', eventId: 'e2', from: 'x', text: 'ignored', route: { channel: 'fake', address: 'a' } })).toEqual({ accepted: false })

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { notifications: { enabled: true, members: [], channels: ['fake'] } } })
    scripts.set(id, [{ text: 'Everywhere.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hi again' } })
    await settle(id)
    expect(fakeOutbox.map((output) => output.kind === 'reply' ? output.text : output.notification)).toEqual(['Everywhere.', 'finished'])
  })
})
