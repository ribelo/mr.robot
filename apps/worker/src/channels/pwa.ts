/**
 * The PWA Channel: chat is the Conversation itself (the PWA reads it over the API and the live
 * socket), so a reply needs no delivery; notifications go out as Web Push through the notified
 * Members' Member DOs, which apply quiet hours.
 */
import type { NotificationKind } from '@mr-robot/protocol'
import type { ChannelAdapter, ChannelOutput, InboundEvent, InboundWakeup } from './channel.ts'

export interface PushTarget {
  notify(memberId: string, event: { robotId: string; robotName: string; kind: NotificationKind; body: string }): Promise<unknown>
}

export class PwaChannel implements ChannelAdapter {
  readonly id = 'pwa'

  constructor(private readonly push: PushTarget) {}

  /** A PWA message is a Member message; the route points back at the Conversation. */
  inbound(event: InboundEvent): InboundWakeup {
    return {
      sender: { kind: 'member', memberId: event.from, name: event.from },
      text: event.text,
      route: { channel: this.id, address: event.route.address },
      dedupeKey: `pwa:${event.eventId}`,
    }
  }

  async deliver(output: ChannelOutput): Promise<boolean> {
    if (output.kind === 'reply') return true
    await Promise.all(output.memberIds.map((memberId) => this.push.notify(memberId, {
      robotId: output.robotId, robotName: output.robotName, kind: output.notification, body: output.text,
    }).catch((error: unknown) => console.warn('push failed', memberId, error))))
    return output.memberIds.length > 0
  }
}
