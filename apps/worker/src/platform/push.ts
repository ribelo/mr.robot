/**
 * Web Push (robot-9xoj): RFC 8291 payload encryption and RFC 8292 VAPID with WebCrypto.
 * The VAPID key pair comes from the deployment (private key as hex, public key base64url).
 */
import { buildPushPayload } from '@block65/webcrypto-web-push'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

export interface DeviceSubscription {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
}

export interface PushNotification {
  readonly title: string
  readonly body: string
  /** Deep link into the PWA, e.g. /#/r/<robot id>. */
  readonly url: string
  readonly tag: string
  readonly urgency: 'low' | 'normal' | 'high'
}

export class PushGone extends Data.TaggedError('PushGone')<{ readonly endpoint: string }> {}
export class PushFailed extends Data.TaggedError('PushFailed')<{ readonly endpoint: string; readonly status: number }> {}

function hexToBase64url(hex: string): string {
  let binary = ''
  for (const pair of hex.trim().match(/../g) ?? []) binary += String.fromCharCode(parseInt(pair, 16))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export interface VapidConfig {
  readonly privateKeyHex: string
  readonly publicKey: string
  readonly subject: string
}

/** Send one notification to one device; a subscription the push service no longer knows fails with PushGone. */
export function sendPush(vapid: VapidConfig, device: DeviceSubscription, notification: PushNotification): Effect.Effect<void, PushGone | PushFailed> {
  return Effect.tryPromise({
    try: async () => {
      const request = await buildPushPayload(
        { data: { ...notification }, options: { ttl: 24 * 3600, urgency: notification.urgency, topic: notification.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } },
        { endpoint: device.endpoint, expirationTime: null, keys: device.keys },
        { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: hexToBase64url(vapid.privateKeyHex) },
      )
      return fetch(device.endpoint, request)
    },
    catch: () => new PushFailed({ endpoint: device.endpoint, status: 0 }),
  }).pipe(Effect.flatMap((response): Effect.Effect<void, PushGone | PushFailed> => {
    if (response.status === 404 || response.status === 410) return Effect.fail(new PushGone({ endpoint: device.endpoint }))
    if (!response.ok) return Effect.fail(new PushFailed({ endpoint: device.endpoint, status: response.status }))
    return Effect.void
  }))
}