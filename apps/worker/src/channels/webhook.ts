/**
 * The webhook Channel (v1.6 ticket 07, cd-q7mc): an outside system POSTs to the Robot's address and
 * the request body becomes a Wake-up. Nothing asked for it inside the app, so a webhook-woken Turn
 * answers like a Routine: in the app, and to the Channels that opted in to hear the Robot unasked.
 * The adapter therefore has no route to reply to and delivers nothing itself.
 */
import type { ChannelAdapter, InboundEvent, InboundWakeup } from './channel.ts'
import { channelSender } from './channel.ts'

/** The largest request body a webhook accepts. */
export const WEBHOOK_MAX_BYTES = 64 * 1024

/** The body quoted in a fence longer than any run of backticks inside it. */
export function quoteBody(body: string): string {
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${body}\n${fence}`
}

/** The Wake-up text for one request: the source, the content type, the body quoted. */
export function webhookText(contentType: string, body: string): string {
  return [`A webhook request arrived (content type: ${contentType === '' ? 'none given' : contentType}). Its body:`, '', quoteBody(body)].join('\n')
}

export class WebhookChannel implements ChannelAdapter {
  readonly id = 'webhook'

  /** An empty event id means no Idempotency-Key: every request wakes the Robot once. */
  inbound(event: InboundEvent): InboundWakeup {
    return {
      sender: channelSender(event),
      text: event.text,
      route: event.route,
      dedupeKey: `webhook:${event.eventId}`,
    }
  }

  async deliver(): Promise<boolean> {
    return false
  }
}
