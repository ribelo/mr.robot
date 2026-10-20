/**
 * The Discord Channel (v1.5 ticket 05, cn-65gg, cn-y1ac): Discord is a second door into the Robot's one
 * Conversation. A message in the Robot's channel (or a direct message to the bot) wakes the Robot, and
 * the final reply goes back to the place and the message it came from. What the Robot says unasked
 * goes to its own channel when it has one and the owner allows it (see recipientsOf in channel.ts).
 */
import type { DiscordFile } from '../connectors/discord.ts'
import type { ChannelAdapter, ChannelOutput, InboundEvent, InboundWakeup } from './channel.ts'
import { channelSender } from './channel.ts'

export interface DiscordSender {
  /** Post text to a Discord channel with the bot's token, as a reply to `replyTo` when given; true when it all went out. */
  post(memberId: string, channelId: string, text: string, replyTo?: string, files?: readonly DiscordFile[]): Promise<boolean>
}

/** The largest file uploaded to Discord; a bigger one is offered as a link into the app (v1.15, gb-s6lx). */
export const DISCORD_UPLOAD_LIMIT = 8 * 1024 * 1024

export class DiscordChannel implements ChannelAdapter {
  readonly id = 'discord'

  constructor(
    private readonly ownerId: string,
    /** The Robot's own channel, or null when it has none (a direct message still reaches it). */
    private readonly channelId: string | null,
    private readonly sender: DiscordSender,
  ) {}

  /** A Discord message is from a person on Discord; the route is the channel and the message to answer. */
  inbound(event: InboundEvent): InboundWakeup {
    return {
      sender: channelSender(event),
      text: event.text,
      route: { channel: this.id, address: event.route.address, messageId: event.eventId },
      dedupeKey: `discord:${event.eventId}`,
    }
  }

  async deliver(output: ChannelOutput): Promise<boolean> {
    if (output.kind === 'reply') {
      // The answer to a Discord message goes where it was asked, quoting it; anything else to the Robot's channel.
      const route = output.route?.channel === this.id ? output.route : null
      const address = route?.address ?? this.channelId
      if (address === null) return false
      // A small file goes up with the message; a big one is a link into the app.
      const small = output.attachments.filter((file) => file.size <= DISCORD_UPLOAD_LIMIT)
      const big = output.attachments.filter((file) => file.size > DISCORD_UPLOAD_LIMIT)
      const text = [output.text, ...big.map((file) => `${file.name}: ${file.link ?? 'too big to send here; open it in Mr. Robot'}`)].join('\n')
      const files = await Promise.all(small.map(async (file): Promise<DiscordFile> => ({ name: file.name, contentType: file.contentType, bytes: await file.read() })))
      return this.sender.post(this.ownerId, address, text, route?.messageId, files)
    }
    // A notification has no route: it goes to the Robot's own channel.
    if (this.channelId === null) return false
    return this.sender.post(this.ownerId, this.channelId, `${output.robotName}: ${output.text}`)
  }
}
