/**
 * The Box's token (v1.16 ticket 06, ob-o6aw): written into the container at boot, it lets ws reach one Robot's Workspace and nothing else.
 * It names its Robot, so the Worker finds the Robot's record without a lookup; it is good while that record says the Box is up, and
 * no longer: a Box that stopped has no token, and the next boot makes a new one.
 *
 * The door is outside the Access login, so the token carries the Worker's signature (BOX_TOKEN_KEY): the edge checks it before it names a
 * Robot, and a made-up token never reaches, or creates, a Robot Durable Object (deep review P5). The Robot then checks that the token is
 * the live one of its Box.
 */
import * as Schema from 'effect/Schema'

/** Where ws reads the token and the address of the Worker inside the container. */
export const BOX_TOKEN_PATH = '/run/mr-robot/token'
export const BOX_ORIGIN_PATH = '/run/mr-robot/origin'

/** The ids Space gives Robots: "r-<uuid>", and "mr-robot-<member id>" for Mr. Robot (space.ts, createRobot and bootstrapMrRobot). */
const ROBOT_ID = '(?:r|mr-robot-m)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** "<robot id>.<token id: 32 random bytes in hex>.<HMAC-SHA256 of '<robot id>.<token id>' under BOX_TOKEN_KEY, in hex>". */
const SignedShape = Schema.String.check(Schema.isPattern(new RegExp(`^${ROBOT_ID}\\.[0-9a-f]{64}\\.[0-9a-f]{64}$`))).pipe(Schema.brand('BoxToken'))

/** A token the Worker signed; only mintBoxToken and signedBoxToken make one. */
export type BoxToken = typeof SignedShape.Type

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const bytesOfHex = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

const signingKey = (key: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/** A new token for a Robot's Box, signed with `key` (the Worker's BOX_TOKEN_KEY). A Robot id Space does not make is a defect. */
export async function mintBoxToken(key: string, robotId: string): Promise<BoxToken> {
  const signed = `${robotId}.${hex(crypto.getRandomValues(new Uint8Array(32)))}`
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(key), new TextEncoder().encode(signed)))
  return Schema.decodeUnknownSync(SignedShape)(`${signed}.${hex(signature)}`)
}

/**
 * The token of an `Authorization: Bearer` header and the Robot it names, when the Worker signed it with `key`; undefined for any other
 * header. Touches no Durable Object.
 */
export async function signedBoxToken(key: string, header: string | null): Promise<{ readonly robotId: string; readonly token: BoxToken } | undefined> {
  const text = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1]
  const parsed = Schema.decodeUnknownOption(SignedShape)(text)
  if (parsed._tag === 'None') return undefined
  const token = parsed.value
  const at = token.lastIndexOf('.')
  const signedPart = token.slice(0, at)
  const genuine = await crypto.subtle.verify('HMAC', await signingKey(key), bytesOfHex(token.slice(at + 1)), new TextEncoder().encode(signedPart))
  return genuine ? { robotId: signedPart.slice(0, signedPart.lastIndexOf('.')), token } : undefined
}

/** Whether two tokens are the same, in time that does not depend on where they differ. */
export async function sameToken(given: string, stored: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, stored].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
  let difference = 0
  for (let at = 0; at < (a?.length ?? 0); at++) difference |= (a?.[at] ?? 0) ^ (b?.[at] ?? 0)
  return difference === 0
}
