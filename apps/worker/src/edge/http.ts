/**
 * A small Effect router for the edge API. Handlers are Effects that either succeed with a
 * JSON value (or a Response) or fail with an ApiError; nothing escapes as an exception.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export class ApiError extends Data.TaggedError('ApiError')<{ readonly status: number; readonly message: string; readonly detail?: string }> {}

export const badRequest = (message: string) => new ApiError({ status: 400, message })
export const unauthorized = (message = 'sign in through Cloudflare Access') => new ApiError({ status: 401, message })
export const forbidden = (message = 'not allowed') => new ApiError({ status: 403, message })
export const notFound = (message = 'not found') => new ApiError({ status: 404, message })
export const conflict = (message: string) => new ApiError({ status: 409, message })

/**
 * Await a promise (usually a Durable Object RPC); a rejection becomes a 500 whose detail is
 * logged, not sent. Routes that want the message shown map it with mapError first.
 */
export function call<A>(run: () => Promise<A>): Effect.Effect<A, ApiError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => {
      // A Durable Object's typed failure (NotFound, Invalid, Conflict) keeps its status across RPC.
      const status = (cause as { status?: unknown } | null)?.status
      if (typeof status === 'number' && status >= 400 && status < 500 && cause instanceof Error) {
        return new ApiError({ status, message: cause.message, detail: cause.message })
      }
      console.error('request failed', cause)
      return new ApiError({ status: 500, message: 'something went wrong; try again', detail: cause instanceof Error ? cause.message : String(cause) })
    },
  })
}

export function decodeBody<S extends Schema.Top>(request: Request, schema: S): Effect.Effect<S['Type'], ApiError, S['DecodingServices']> {
  return Effect.tryPromise({ try: () => request.json(), catch: () => badRequest('expected a JSON body') }).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError((error) => badRequest(String(error))))),
  )
}

/** Named parameters of a path pattern: '/api/robots/:id/proposals/:proposal' gives { id, proposal }. */
export type PathParams<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}` ? { readonly [K in Name]: string } & PathParams<`/${Rest}`>
    : P extends `${string}:${infer Name}` ? { readonly [K in Name]: string }
      : Record<never, string>

export type Handler<C, P = Record<string, string>> = (context: C, params: P) => Effect.Effect<unknown, ApiError>

interface Route<C> {
  readonly method: string
  readonly pattern: URLPattern
  readonly handler: Handler<C>
}

export class Router<C> {
  private readonly routes: Route<C>[] = []

  on<P extends string>(method: string, path: P, handler: Handler<C, PathParams<P>>): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname: path }), handler: handler as Handler<C> })
    return this
  }

  match(request: Request): { handler: Handler<C>; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== request.method) continue
      const match = route.pattern.exec(request.url)
      if (match !== null) {
        const params = Object.fromEntries(Object.entries(match.pathname.groups).filter((entry): entry is [string, string] => entry[1] !== undefined))
        return { handler: route.handler, params }
      }
    }
    return undefined
  }
}

export function respond(effect: Effect.Effect<unknown, ApiError>): Effect.Effect<Response> {
  return effect.pipe(
    Effect.map((value) => value instanceof Response ? value : json(value ?? { ok: true })),
    Effect.catchTag('ApiError', (error) => Effect.succeed(json({ error: error.message }, error.status))),
  )
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}