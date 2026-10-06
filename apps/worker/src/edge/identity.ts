/**
 * Who is calling (robot-7v5x). Cloudflare Access verifies the e-mail code and signs a JWT for
 * every request it admits (Cf-Access-Jwt-Assertion). The Worker accepts only a token signed by
 * its own Access team (ACCESS_TEAM_DOMAIN), unexpired, carrying an e-mail. workerd's ctx.access
 * is used when present. DEV_IDENTITY exists only in local development and tests, where Access is
 * absent; there the x-dev-identity header can switch Members.
 */
import * as Effect from 'effect/Effect'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from '../env.ts'
import { unauthorized, type ApiError } from './http.ts'

interface AccessContext {
  readonly aud: string
  getIdentity(): Promise<{ readonly email?: string } | undefined>
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function keysOf(team: string) {
  let keys = keySets.get(team)
  if (keys === undefined) {
    keys = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`))
    keySets.set(team, keys)
  }
  return keys
}

/** The e-mail in a valid Access token of this deployment's team. */
export function verifyAccessToken(token: string, team: string): Effect.Effect<string, ApiError> {
  return Effect.tryPromise({
    try: () => jwtVerify(token, keysOf(team), { issuer: `https://${team}` }),
    catch: () => unauthorized('your Cloudflare Access sign-in is not valid; sign in again'),
  }).pipe(Effect.flatMap(({ payload }) => typeof payload['email'] === 'string' && payload['email'] !== ''
    ? Effect.succeed(payload['email'])
    : Effect.fail(unauthorized('your Cloudflare Access sign-in has no e-mail address'))))
}

export function identityEmail(request: Request, env: Env, ctx: ExecutionContext): Effect.Effect<string, ApiError> {
  const access = (ctx as ExecutionContext & { access?: AccessContext }).access
  if (access !== undefined) {
    return Effect.tryPromise({ try: () => access.getIdentity(), catch: () => unauthorized() }).pipe(
      Effect.flatMap((identity) => identity?.email === undefined ? Effect.fail(unauthorized()) : Effect.succeed(identity.email)),
    )
  }
  const token = request.headers.get('cf-access-jwt-assertion')
  if (token !== null && env.ACCESS_TEAM_DOMAIN !== undefined && env.ACCESS_TEAM_DOMAIN !== '') {
    return verifyAccessToken(token, env.ACCESS_TEAM_DOMAIN)
  }
  if (env.DEV_IDENTITY !== undefined && env.DEV_IDENTITY !== '') {
    return Effect.succeed(request.headers.get('x-dev-identity') ?? env.DEV_IDENTITY)
  }
  return Effect.fail(unauthorized())
}
