import { afterEach, describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { verifyAccessToken } from '../src/edge/identity.ts'

const TEAM = 'team-a.cloudflareaccess.com'
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

async function team() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
    throw new Error(`unexpected fetch ${String(input)}`)
  }) as typeof fetch
  return (claims: Record<string, unknown>, issuer = `https://${TEAM}`, expires = '1h') =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setIssuedAt().setExpirationTime(expires).sign(privateKey)
}

const run = (token: string) => Effect.runPromise(Effect.result(verifyAccessToken(token, TEAM)))

describe('Cloudflare Access identity (robot-7v5x)', () => {
  it('accepts a token of its own team and reads the e-mail', async () => {
    const sign = await team()
    const result = await run(await sign({ email: 'anna@example.com' }))
    expect(result).toMatchObject({ _tag: 'Success', success: 'anna@example.com' })
  })

  it('refuses another team, an expired token and a token without e-mail', async () => {
    const sign = await team()
    for (const token of [
      await sign({ email: 'x@example.com' }, 'https://other.cloudflareaccess.com'),
      await sign({ email: 'x@example.com' }, `https://${TEAM}`, '-1m'),
      await sign({}),
    ]) {
      expect((await run(token))._tag).toBe('Failure')
    }
    const { privateKey } = await generateKeyPair('RS256')
    const forged = await new SignJWT({ email: 'x@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(`https://${TEAM}`).setExpirationTime('1h').sign(privateKey)
    expect((await run(forged))._tag).toBe('Failure')
  })
})
