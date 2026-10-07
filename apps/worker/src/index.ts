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
export { ChromeContainer } from './browser/chrome.ts'

const WS_PATH = new URLPattern({ pathname: '/api/robots/:id/ws' })

/**
 * The Host channel (v1.2): the desktop app is not a browser session, so these paths are outside
 * Cloudflare Access (a bypass application in infra/stack.ts) and carry the host's own token instead.
 */
async function hostChannel(request: Request, env: Env, path: string): Promise<Response> {
  const home = env.HOME.getByName(HOME_ID)
  if (path === '/api/host/pair/start' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; platform?: unknown }
    if (typeof body.name !== 'string' || body.name.trim() === '') return json({ error: 'give the host a name' }, 400)
    const { code } = await home.startPairing(body.name, typeof body.platform === 'string' ? body.platform : 'unknown')
    return json({ code, approveUrl: `${new URL(request.url).origin}/#/pair/${code}` })
  }
  if (path === '/api/host/pair/poll') return json(await home.pollPairing(new URL(request.url).searchParams.get('code') ?? ''))
  if (path === '/api/host/connect' || path === '/api/host/relay') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a WebSocket', { status: 426 })
    const hostId = request.headers.get('x-host-id') ?? ''
    const owner = await home.hostOwner(hostId)
    if (owner === null) return new Response('unknown host', { status: 401 })
    const url = new URL(request.url)
    const headers = new Headers(request.headers)
    headers.set('x-origin', url.origin)
    const target = path === '/api/host/connect' ? 'https://member/host/connect' : `https://member/host/relay?session=${encodeURIComponent(url.searchParams.get('session') ?? '')}&side=host`
    return env.MEMBER.getByName(owner).fetch(new Request(target, { headers }))
  }
  return json({ error: 'no such endpoint' }, 404)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path.startsWith('/api/host/')) {
      return hostChannel(request, env, path).catch((error: unknown) => {
        const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500
        if (status === 500) console.error('host channel failed', error)
        return json({ error: error instanceof Error ? error.message : String(error) }, status)
      })
    }
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