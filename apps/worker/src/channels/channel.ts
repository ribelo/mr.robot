/**
 * The Channel seam (robot-vfqd, robot-9xoj): an adapter turns external events into Wake-ups on a
 * Robot's one Conversation and carries the Robot's output back out. The Robot never knows which
 * Channels exist; it only sees labelled messages and writes replies.
 *
 * Contract (checked by test/channel-contract.ts for every adapter):
 * 1. inbound(event) yields a Wake-up whose sender names the channel and whose route lets the
 *    reply come back to the same place (and to the message that asked, when the channel has one);
 * 2. deliver(output) is called only for the Channels recipientsOf names. The rule is one question,
 *    "who asked for this?":
 *    - a reply goes back where the question came from: the final reply of a Turn that a Channel
 *      woke goes to that Channel; a Turn woken by a Member in the app answers in the app only;
 *    - only the final reply of a Turn leaves the app; interim replies stay in the Conversation;
 *    - what nobody asked for (the final reply of a Task's Turn, a Robot message, a takeover, the
 *      platform) and notifications other than "finished" go to the Channels that opted in to
 *      hear the Robot unasked (Discord: its own channel, when the owner allows it);
 *    - a "finished" notification only repeats the reply, so such Channels never get it;
 *    - the Channels in the Robot's list (the app, test doubles) hear everything;
 * 3. delivery is idempotent per output id, so a retried Turn does not post twice.
 */
import type { NotificationKind, Sender } from '@mr-robot/protocol'

/** Where a reply should go: the Channel and its own address (a chat, a thread, a user). */
export interface ReplyRoute {
  readonly channel: string
  readonly address: string
  /** The message that asked, when the Channel can quote it (a Discord reply). */
  readonly messageId?: string
}

export interface InboundEvent {
  readonly channel: string
  /** Stable id of the external event, for deduplication. */
  readonly eventId: string
  readonly from: string
  readonly text: string
  readonly route: ReplyRoute
  /** The Channel identified the sender as the Robot's owner: the message steers (ao-rsfo). */
  readonly fromOwner?: boolean
}

export interface InboundWakeup {
  readonly sender: Sender
  readonly text: string
  readonly route: ReplyRoute
  /** The event's key for deduplication; null when the Channel deduplicates by itself (the webhook). */
  readonly dedupeKey: string | null
}

export type ChannelOutput =
  | {
      readonly kind: 'reply'
      readonly id: string
      readonly robotId: string
      readonly robotName: string
      readonly text: string
      /** Where the question came from; null when it came from the app, or from nobody. */
      readonly route: ReplyRoute | null
      /** The last reply of its Turn. */
      readonly final: boolean
      /** Nobody asked for this Turn on any Channel: a Task, a Robot message, a takeover, the platform. */
      readonly unprompted: boolean
    }
  | {
      readonly kind: 'notification'
      readonly id: string
      readonly robotId: string
      readonly robotName: string
      readonly notification: NotificationKind
      readonly text: string
      readonly memberIds: readonly string[]
      /** The notification only repeats a Turn's reply. */
      readonly replyCopy: boolean
    }

export interface ChannelAdapter {
  readonly id: string
  /** An external event becomes a Wake-up on the Robot's Conversation. */
  inbound(event: InboundEvent): InboundWakeup
  /** Robot output leaves through this Channel; true when something was sent. */
  deliver(output: ChannelOutput): Promise<boolean>
}

export function channelSender(event: InboundEvent): Sender {
  return { kind: 'channel', channel: event.channel, from: event.from }
}

/**
 * Which adapters receive an output (the functional core of the contract above).
 * `enabled` hear everything; `unprompted` opted in to hear only what nobody asked for.
 */
export function recipientsOf(output: ChannelOutput, enabled: readonly string[], unprompted: readonly string[] = []): string[] {
  const ids = new Set(enabled)
  if (output.kind === 'reply') {
    if (output.final && output.route !== null) ids.add(output.route.channel)
    else if (output.final && output.unprompted) for (const id of unprompted) ids.add(id)
  } else if (!output.replyCopy) {
    for (const id of unprompted) ids.add(id)
  }
  return [...ids]
}

/** Deliver to every adapter that should get this output, once per output id per adapter. */
export async function fanOut(
  output: ChannelOutput,
  enabled: readonly string[],
  adapters: ReadonlyMap<string, ChannelAdapter>,
  delivered: { has(key: string): boolean; add(key: string): void },
  unprompted: readonly string[] = [],
): Promise<string[]> {
  const sent: string[] = []
  for (const id of recipientsOf(output, enabled, unprompted)) {
    const adapter = adapters.get(id)
    const key = `${id}:${output.id}`
    if (adapter === undefined || delivered.has(key)) continue
    if (await adapter.deliver(output)) sent.push(id)
    delivered.add(key)
  }
  return sent
}
