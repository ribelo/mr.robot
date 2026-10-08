/**
 * The Discord Channel (v1.5 ticket 05, cn-65gg, cn-y1ac): messages on a Robot's Discord channel (or a
 * direct message to the bot) wake the Robot, and its replies and notifications go back to the channel
 * the message came from. The Robot only sees a labelled message, as with every Channel.
 */
import type { ChannelAdapter, ChannelOutput, InboundEvent, InboundWakeup } from './channel.ts'
import { channelSender } from './channel.ts'

export interface DiscordSender {
  /** Post text to a Discord channel with the bot's token; true when it went out. */
  post(memberId: string, channelId: string, text: string): Promise<boolean>
}

export class DiscordChannel implements ChannelAdapter {
  readonly id = 'discord'

  constructor(
    private readonly ownerId: string,
    /** The Robot's own channel; a reply to a message from elsewhere answers that channel instead. */
    private readonly channelId: string,
    private readonly sender: DiscordSender,
  ) {}

  /** A Discord message is from a person on Discord; the route is the channel it arrived in. */
  inbound(event: InboundEvent): InboundWakeup {
    return {
      sender: channelSender(event),
      text: event.text,
      route: { channel: this.id, address: event.route.address },
      dedupeKey: `discord:${event.eventId}`,
    }
  }

  async deliver(output: ChannelOutput): Promise<boolean> {
    if (output.kind === 'reply') {
      return this.sender.post(this.ownerId, output.route?.address ?? this.channelId, output.text)
    }
    // A notification has no route: it goes to the Robot's own channel.
    return this.sender.post(this.ownerId, this.channelId, `${output.robotName}: ${output.text}`)
  }
}
