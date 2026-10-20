/**
 * The Box's token (v1.16 ticket 06, ob-o6aw): written into the container at boot, it lets ws reach one Robot's Workspace and nothing else.
 * It names its Robot, so the Worker finds the Robot's record without a lookup; it is good while that record says the Box is up, and
 * no longer: a Box that stopped has no token, and the next boot makes a new one.
 */

/** Where ws reads the token and the address of the Worker inside the container. */
export const BOX_TOKEN_PATH = '/run/mr-robot/token'
export const BOX_ORIGIN_PATH = '/run/mr-robot/origin'

/** A new token for a Robot's Box: "<robot id>.<32 random bytes in hex>". */
export function newBoxToken(robotId: string): string {
  return `${robotId}.${[...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/** The Robot a token names, or undefined when it is not shaped like one. */
export function robotOfToken(token: string): string | undefined {
  const dot = token.lastIndexOf('.')
  return dot > 0 && dot < token.length - 1 ? token.slice(0, dot) : undefined
}

/** The token of an `Authorization: Bearer` header. */
export function bearerToken(header: string | null): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return match?.[1]
}

/** Whether two tokens are the same, in time that does not depend on where they differ. */
export async function sameToken(given: string, stored: string): Promise<boolean> {
  const [a, b] = await Promise.all([given, stored].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))
  let difference = 0
  for (let at = 0; at < a!.length; at++) difference |= a![at]! ^ b![at]!
  return difference === 0
}
