/**
 * The token of a shared Page (v1.17 ticket 06, dp-hf7v): "<member id>.<32 random bytes in hex>.<HMAC-SHA256 of the first two parts>". It names the
 * Member who shares, so the edge finds the share without a lookup, and it carries the Worker's signature, so a made-up token never reaches a
 * Durable Object. The Member keeps the token sealed and finds a share by the token's hash; Stop sharing deletes that row, and the link is dead.
 */
import * as Schema from 'effect/Schema'

const MEMBER_ID = 'm-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const SignedShape = Schema.String.check(Schema.isPattern(new RegExp('^' + MEMBER_ID + '\\.[0-9a-f]{64}\\.[0-9a-f]{64}$'))).pipe(Schema.brand('ShareToken'))

/** A share token the Worker signed; only mintShareToken and signedShareToken make one. */
export type ShareToken = typeof SignedShape.Type

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const bytesOfHex = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

/** The signing key: DATA_KEY for this purpose only. */
const signingKey = (dataKey: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', new TextEncoder().encode(dataKey + ':shared-pages'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function mintShareToken(dataKey: string, memberId: string): Promise<ShareToken> {
  const signed = memberId + '.' + hex(crypto.getRandomValues(new Uint8Array(32)))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(dataKey), new TextEncoder().encode(signed)))
  return Schema.decodeUnknownSync(SignedShape)(signed + '.' + hex(signature))
}

/** The token and the Member it names, when the Worker signed it; undefined for any other text. Touches no Durable Object. */
export async function signedShareToken(dataKey: string, text: string): Promise<{ readonly memberId: string; readonly token: ShareToken } | undefined> {
  const parsed = Schema.decodeUnknownOption(SignedShape)(text)
  if (parsed._tag === 'None') return undefined
  const token = parsed.value
  const at = token.lastIndexOf('.')
  const signedPart = token.slice(0, at)
  const genuine = await crypto.subtle.verify('HMAC', await signingKey(dataKey), bytesOfHex(token.slice(at + 1)), new TextEncoder().encode(signedPart))
  return genuine ? { memberId: signedPart.slice(0, signedPart.indexOf('.')), token } : undefined
}

/** The hash a share is found by. */
export async function shareTokenHash(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
}

/** The public address of a shared Page. */
export const sharedPagePath = (token: string): string => '/p/' + token
