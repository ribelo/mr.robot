/**
 * The Channel seam (robot-vfqd, robot-9xoj): an adapter turns external events into Wake-ups on a
 * Robot's one Conversation and carries the Robot's output back out. The Robot never knows which
 * Channels exist; it only sees labelled messages and writes replies.
 *
 * Contract (checked by test/channel-contract.ts for every adapter):
 * 1. inbound(event) yields a Wake-up whose sender names the channel and whose route lets the
 *    reply come back to the same place;
 * 2. deliver(output) is called for every enabled Channel when the Robot replies or notifies,
 *    and for the origin Channel when the reply answers a message from it;
 * 3. delivery is idempotent per output id, so a retried Turn does not post twice.
 */
import type { NotificationKind, Sender } from '@mr-robot/protocol'

/** Where a reply should go: the Channel and its own address (a chat, a thread, a user). */
export interface ReplyRoute {
  readonly channel: string
  readonly address: string
}

export interface InboundEvent {
  readonly channel: string
  /** Stable id of the external event, for deduplication. */
  readonly eventId: string
  readonly from: string
  readonly text: string
  readonly route: ReplyRoute
}

export interface InboundWakeup {
  readonly sender: Sender
  readonly text: string
  readonly route: ReplyRoute
  readonly dedupeKey: string
}

export type ChannelOutput =
  | { readonly kind: 'reply'; readonly id: string; readonly robotId: string; readonly robotName: string; readonly text: string; readonly route: ReplyRoute | null }
  | { readonly kind: 'notification'; readonly id: string; readonly robotId: string; readonly robotName: string; readonly notification: NotificationKind; readonly text: string; readonly memberIds: readonly string[] }

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

/** Which adapters receive an output: enabled ones, plus the origin of a reply. */
export function recipientsOf(output: ChannelOutput, enabled: readonly string[]): string[] {
  const ids = new Set(enabled)
  if (output.kind === 'reply' && output.route !== null) ids.add(output.route.channel)
  return [...ids]
}

/** Deliver to every adapter that should get this output, once per output id per adapter. */
export async function fanOut(
  output: ChannelOutput,
  enabled: readonly string[],
  adapters: ReadonlyMap<string, ChannelAdapter>,
  delivered: { has(key: string): boolean; add(key: string): void },
): Promise<string[]> {
  const sent: string[] = []
  for (const id of recipientsOf(output, enabled)) {
    const adapter = adapters.get(id)
    const key = `${id}:${output.id}`
    if (adapter === undefined || delivered.has(key)) continue
    if (await adapter.deliver(output)) sent.push(id)
    delivered.add(key)
  }
  return sent
}
