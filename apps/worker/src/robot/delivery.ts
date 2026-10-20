/**
 * How a Wake-up reaches a Robot (v1.14, ao-9570): decided from who sent it, never from what it says.
 * The owner (in the app or on any Channel that identifies them) and the owner's Mr. Robot acting as deputy
 * steer: their message reaches a running Turn at its next step. Everything else follows up in a Turn of its own.
 */
import type { Sender, WakeupKind } from '@mr-robot/protocol'
import type { Delivery, Wakeup } from './store.ts'

/** Mr. Robot's id for a Member (home.ts bootstrapMrRobot). */
export const mrRobotIdOf = (memberId: string): string => `mr-robot-${memberId}`

export interface DeliveryInput {
  readonly kind: WakeupKind
  readonly sender: Sender
  readonly payload?: Record<string, unknown>
  /** The owner asked for a follow-up on purpose (Ctrl+Enter in the composer, ao-q2z4). */
  readonly followup?: boolean
}

export function deliveryOf(input: DeliveryInput, ownerId: string): Delivery {
  if (input.followup === true) return 'followup'
  switch (input.kind) {
    case 'member':
      return input.sender.kind === 'member' && input.sender.memberId === ownerId ? 'steer' : 'followup'
    case 'channel':
      // The Channel identified the sender as the owner (ao-rsfo); a webhook never is.
      return input.payload?.['fromOwner'] === true ? 'steer' : 'followup'
    // The owner's answer to a question or a credential request is theirs, like a message (v1.15).
    case 'platform':
      return input.payload?.['askAnswer'] !== undefined ? 'steer' : 'followup'
    default:
      return 'followup'
  }
}

/**
 * Whether the owner caused a Wake-up (v1.15, gb-xgd7): their message in the app or on a Channel that knows them, their answer to an Ask,
 * the Takeover they handed back. Tasks, Robot messages (Mr. Robot's to his staff too), Subagent reports and platform notices are nobody's ask.
 */
export function causedByOwner(wakeup: Pick<Wakeup, 'kind' | 'sender' | 'payload'>, ownerId: string): boolean {
  switch (wakeup.kind) {
    case 'member': return wakeup.sender.kind === 'member' && wakeup.sender.memberId === ownerId
    case 'channel': return wakeup.payload['fromOwner'] === true
    case 'takeover': return true
    case 'platform': return wakeup.payload['byOwner'] === true
    default: return false
  }
}

/** A Robot message from the owner's Mr. Robot directing his staff steers (ao-8848); a Thread message never does. */
export function robotMessageDelivery(from: { readonly robotId: string; readonly ownerId: string }, kind: 'request' | 'reply' | 'thread', ownerId: string): Delivery {
  return kind !== 'thread' && from.ownerId === ownerId && from.robotId === mrRobotIdOf(ownerId) ? 'steer' : 'followup'
}

/** Payload fields that tie a Wake-up to something of its own (an Ask's answer, a request to reply to): it is never joined. */
const OWN_FIELDS = ['toolCallAnswer', 'helpAnswer', 'askAnswer', 'requestId', 'replyHandle', 'replyTo', 'thread', 'threadId', 'taskId', 'summary']

const senderKey = (wakeup: Wakeup): string | undefined => {
  if (OWN_FIELDS.some((field) => wakeup.payload[field] !== undefined)) return undefined
  if (wakeup.kind === 'member' && wakeup.sender.kind === 'member') return `member:${wakeup.sender.memberId}`
  if (wakeup.kind === 'channel' && wakeup.sender.kind === 'channel') return `channel:${wakeup.sender.channel}:${wakeup.sender.from}:${JSON.stringify(wakeup.payload['route'] ?? null)}`
  return undefined
}

/**
 * The queued follow-ups that join the Turn of `first` (ao-rdhs): from the same sender, in queue order.
 * A Task Wake-up and a Wake-up with something of its own (an answer, a Robot request) never join.
 */
export function joinable(first: Wakeup, queued: readonly Wakeup[]): Wakeup[] {
  const key = senderKey(first)
  if (key === undefined) return []
  return queued.filter((wakeup) => wakeup.id !== first.id && wakeup.delivery === 'followup' && senderKey(wakeup) === key)
}
