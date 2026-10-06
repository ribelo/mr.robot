/**
 * The contract every Channel adapter must keep. Run it against a new adapter (Discord after v1)
 * with describeChannelContract(name, makeAdapter, sentLog).
 */
import { describe, expect, it } from 'vitest'
import { fanOut, recipientsOf, type ChannelAdapter, type ChannelOutput, type InboundEvent } from '../src/channels/channel.ts'

const event: InboundEvent = { channel: 'x', eventId: 'evt-1', from: 'someone', text: 'hello robot', route: { channel: 'x', address: 'thread-7' } }

export function describeChannelContract(name: string, make: () => ChannelAdapter, sent: () => number) {
  describe(`Channel contract: ${name}`, () => {
    it('turns an inbound event into a Wake-up with the text, a sender and a reply route to itself', () => {
      const adapter = make()
      const wakeup = adapter.inbound({ ...event, channel: adapter.id, route: { channel: adapter.id, address: 'thread-7' } })
      expect(wakeup.text).toBe('hello robot')
      expect(wakeup.route).toEqual({ channel: adapter.id, address: 'thread-7' })
      expect(wakeup.dedupeKey).toContain('evt-1')
      expect(['member', 'channel']).toContain(wakeup.sender.kind)
    })

    it('is deduplicated: the same event id gives the same dedupe key', () => {
      const adapter = make()
      const first = adapter.inbound({ ...event, channel: adapter.id })
      const again = adapter.inbound({ ...event, channel: adapter.id, text: 'retried' })
      expect(again.dedupeKey).toBe(first.dedupeKey)
    })

    it('receives replies and notifications when enabled, once per output', async () => {
      const adapter = make()
      const adapters = new Map([[adapter.id, adapter]])
      const delivered = new Set<string>()
      const before = sent()
      const reply: ChannelOutput = { kind: 'reply', id: 'out-1', robotId: 'r', robotName: 'R', text: 'done', route: null }
      const notification: ChannelOutput = { kind: 'notification', id: 'out-2', robotId: 'r', robotName: 'R', notification: 'finished', text: 'done', memberIds: ['m-1'] }
      expect(await fanOut(reply, [adapter.id], adapters, delivered)).toEqual([adapter.id])
      await fanOut(reply, [adapter.id], adapters, delivered)
      await fanOut(notification, [adapter.id], adapters, delivered)
      expect(sent() - before).toBeGreaterThanOrEqual(1)
      expect(delivered.size).toBe(2)
    })

    it('gets a reply that answers its own message even when not enabled, and nothing else', async () => {
      const adapter = make()
      const reply: ChannelOutput = { kind: 'reply', id: 'out-3', robotId: 'r', robotName: 'R', text: 'answer', route: { channel: adapter.id, address: 'thread-7' } }
      expect(recipientsOf(reply, [])).toEqual([adapter.id])
      const notification: ChannelOutput = { kind: 'notification', id: 'out-4', robotId: 'r', robotName: 'R', notification: 'blocked', text: 'x', memberIds: [] }
      expect(recipientsOf(notification, [])).toEqual([])
    })
  })
}
