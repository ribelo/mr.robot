/**
 * The edge Worker: Access identity, the HTTP and WebSocket API, and routing to the
 * Durable Objects that own the data. Static PWA assets are served by the assets
 * binding before the Worker runs; only /api/* reaches this code.
 */
import * as Effect from 'effect/Effect'
import { api, type ApiContext } from './edge/api.ts'
import { call, forbidden, json, notFound, respond, type ApiError } from './edge/http.ts'
import { identityEmail } from './edge/identity.ts'
import { HOME_ID, type Env } from './env.ts'
import type { SignIn } from './home/home.ts'

export { Robot } from './robot/robot.ts'
export { Member } from './member/member.ts'
export { Home } from './home/home.ts'

const WS_PATH = new URLPattern({ pathname: '/api/robots/:id/ws' })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const program = Effect.gen(function* () {
      const email = yield* identityEmail(request, env, ctx)
      const signIn = yield* call((): Promise<SignIn> => env.HOME.getByName(HOME_ID).signIn(email))
      if (!signIn.ok) {
        return yield* Effect.fail<ApiError>(forbidden(signIn.reason === 'removed' ? 'your access to this Home was removed' : 'ask the Home admin for an invite'))
      }
      const member = signIn.member
      const socket = WS_PATH.exec(request.url)
      if (socket !== null) {
        const id = socket.pathname.groups['id']!
        const access = yield* call(() => env.HOME.getByName(HOME_ID).access(member.id, id))
        if (access === null) return yield* Effect.fail<ApiError>(notFound('no such robot'))
        const headers = new Headers(request.headers)
        headers.set('x-member-id', member.id)
        return yield* call(() => env.ROBOT.getByName(id).fetch(new Request(request, { headers })))
      }
      const route = api.match(request)
      if (route === undefined) return json({ error: 'no such endpoint' }, 404)
      const context: ApiContext = { request, env, ctx, member }
      return yield* route.handler(context, route.params)
    })
    return Effect.runPromise(respond(program))
  },
} satisfies ExportedHandler<Env>