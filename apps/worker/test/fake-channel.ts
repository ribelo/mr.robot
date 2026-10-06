import type { ChannelAdapter, ChannelOutput, InboundEvent, InboundWakeup } from '../src/channels/channel.ts'
import { channelSender } from '../src/channels/channel.ts'

/** A chat-like Channel that records what it would post: the shape Discord will take. */
export const fakeOutbox: ChannelOutput[] = []

export class FakeChannel implements ChannelAdapter {
  readonly id = 'fake'

  inbound(event: InboundEvent): InboundWakeup {
    return { sender: channelSender(event), text: event.text, route: event.route, dedupeKey: `fake:${event.eventId}` }
  }

  async deliver(output: ChannelOutput): Promise<boolean> {
    fakeOutbox.push(output)
    return true
  }
}
