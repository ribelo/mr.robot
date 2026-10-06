/**
 * Who is calling (robot-7v5x). Cloudflare Access verifies the e-mail code and workerd
 * exposes the admitted identity on ctx.access; nothing else is trusted. DEV_IDENTITY
 * exists only in local development and tests, where Access is absent; there the
 * x-dev-identity header can switch Members.
 */
import * as Effect from 'effect/Effect'
import type { Env } from '../env.ts'
import { unauthorized, type ApiError } from './http.ts'

interface AccessContext {
  readonly aud: string
  getIdentity(): Promise<{ readonly email?: string } | undefined>
}

export function identityEmail(request: Request, env: Env, ctx: ExecutionContext): Effect.Effect<string, ApiError> {
  const access = (ctx as ExecutionContext & { access?: AccessContext }).access
  if (access !== undefined) {
    return Effect.tryPromise({ try: () => access.getIdentity(), catch: () => unauthorized() }).pipe(
      Effect.flatMap((identity) => identity?.email === undefined ? Effect.fail(unauthorized()) : Effect.succeed(identity.email)),
    )
  }
  if (env.DEV_IDENTITY !== undefined && env.DEV_IDENTITY !== '') {
    return Effect.succeed(request.headers.get('x-dev-identity') ?? env.DEV_IDENTITY)
  }
  return Effect.fail(unauthorized())
}
