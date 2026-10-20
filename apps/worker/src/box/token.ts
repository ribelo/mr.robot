/**
 * The Box's token (v1.16 ticket 06, ob-o6aw): written into the container at boot, it lets ws reach one Robot's Workspace and nothing else.
 * It names its Robot, so the Worker finds the Robot's record without a lookup; it is good while that record says the Box is up, and
 * no longer: a Box that stopped has no token, and the next boot makes a new one.
 */
import * as Schema from 'effect/Schema'

/** Where ws reads the token and the address of the Worker inside the container. */
export const BOX_TOKEN_PATH = '/run/mr-robot/token'
export const BOX_ORIGIN_PATH = '/run/mr-robot/origin'

/** "<robot id>.<32 random bytes in hex>". */
export const BoxToken = Schema.String.check(Schema.isPattern(/^[^.\s]+\.[0-9a-f]{64}$/)).pipe(Schema.brand('BoxToken'))
export type BoxToken = typeof BoxToken.Type

/** A new token for a Robot's Box. */
export function newBoxToken(robotId: string): BoxToken {
  return Schema.decodeUnknownSync(BoxToken)(`${robotId}.${[...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
}

/** The Robot a token names. */
export function robotOfToken(token: BoxToken): string {
  return token.slice(0, token.lastIndexOf('.'))
}

/** The token of an `Authorization: Bearer` header, when it is shaped like one. */
export function bearerToken(header: string | null): BoxToken | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  const parsed = Schema.decodeUnknownOption(BoxToken)(match?.[1])
  return parsed._tag === 'Some' ? parsed.value : undefined
}

/** Whether two tokens are the same, in time that does not depend on where they differ. */
export async function sameToken(given: string, stored: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, stored].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
  let difference = 0
  for (let at = 0; at < (a?.length ?? 0); at++) difference |= (a?.[at] ?? 0) ^ (b?.[at] ?? 0)
  return difference === 0
}
