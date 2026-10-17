/**
 * The webhook Channel (v1.6 ticket 07, cd-q7mc): an outside system POSTs to the Robot's address and
 * the request body becomes a Wake-up. Nothing asked for it inside the app, so a webhook-woken Turn
 * answers like a Task's Turn: in the app, and to the Channels that opted in to hear the Robot unasked.
 * The adapter therefore has no route to reply to and delivers nothing itself.
 */
import type { ChannelAdapter, InboundEvent, InboundWakeup } from './channel.ts'
import { channelSender } from './channel.ts'

/** The largest request body a webhook accepts. */
export const WEBHOOK_MAX_BYTES = 64 * 1024

/** The longest Idempotency-Key a webhook accepts. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200

/** How many recent Idempotency-Keys a Robot remembers; an older key wakes the Robot again. */
export const IDEMPOTENCY_KEYS_KEPT = 100

/** The longest content type quoted in the Wake-up; a longer one is cut. */
const CONTENT_TYPE_MAX_LENGTH = 200

/** The body quoted in a fence longer than any run of backticks inside it. */
export function quoteBody(body: string): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${body}\n${fence}`
}

/** The Wake-up text for one request: the source, the content type, the body quoted. */
export function webhookText(contentType: string, body: string): string {
  const type = contentType.slice(0, CONTENT_TYPE_MAX_LENGTH)
  return [`A webhook request arrived (content type: ${type === '' ? 'none given' : type}). Its body:`, '', quoteBody(body)].join('\n')
}

/**
 * The remembered Idempotency-Keys after one more request: `seen` when the key is already in it (a
 * duplicate), otherwise the key appended and only the last IDEMPOTENCY_KEYS_KEPT kept.
 */
export function rememberIdempotencyKey(seen: readonly string[], key: string): { readonly duplicate: boolean; readonly seen: readonly string[] } {
  if (seen.includes(key)) return { duplicate: true, seen }
  return { duplicate: false, seen: [...seen, key].slice(-IDEMPOTENCY_KEYS_KEPT) }
}

export class WebhookChannel implements ChannelAdapter {
  readonly id = 'webhook'

  /** The Robot deduplicates webhook requests by their Idempotency-Key, keeping a bounded list. */
  inbound(event: InboundEvent): InboundWakeup {
    return {
      sender: channelSender(event),
      text: event.text,
      route: event.route,
      dedupeKey: null,
    }
  }

  async deliver(): Promise<boolean> {
    return false
  }
}
