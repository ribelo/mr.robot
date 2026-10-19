import type { Attachment, ChatItem } from '@mr-robot/protocol'

/** A message the Member sent that the Conversation does not hold yet (ap-3si6, ap-ceqx). */
export interface PendingSend {
  /** Chosen here; the API accepts it once, so a retry never sends twice. */
  readonly clientId: string
  readonly text: string
  readonly attachments: readonly Attachment[]
  readonly followup?: true
  /** Pending: waiting for the server. Failed: the server refused it, or could not be reached. */
  readonly state: 'pending' | 'failed'
  readonly error?: string
  /** Ids of the items the Conversation held when the message was sent; only a newer item can confirm it. */
  readonly knownItems: ReadonlySet<string>
}

/**
 * The pending sends the Conversation does not hold yet. A send is confirmed by the message that carries
 * its client id. A message without one (sent before the Worker kept client ids) confirms by text: a
 * new message of this Member with the same text, each item at most one send, oldest send first.
 */
export function unconfirmed(pending: readonly PendingSend[], items: readonly ChatItem[], meId: string): PendingSend[] {
  const carried = new Set(items.flatMap((item) => (item.kind === 'message' && item.clientId !== undefined ? [item.clientId] : [])))
  const used = new Set<string>()
  return pending.filter((send) => {
    if (carried.has(send.clientId)) return false
    const match = items.find((item) => item.kind === 'message' && item.clientId === undefined && item.sender.kind === 'member' && item.sender.memberId === meId
      && item.text === send.text && !send.knownItems.has(item.id) && !used.has(item.id))
    if (match === undefined) return true
    used.add(match.id)
    return false
  })
}
