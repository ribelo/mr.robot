/**
 * The webhook Channel's door (v1.6 ticket 07, cd-pqt8, cd-q7mc, cd-s07d): POST /hooks/<robotId>/<key>.
 * It is outside the Access login, so the key is the credential: a wrong key answers 401, an oversized
 * body 413, and neither wakes the Robot. The key is checked before the body is read. The Robot is told
 * once per Idempotency-Key.
 */
import * as Effect from 'effect/Effect'
import { IDEMPOTENCY_KEY_MAX_LENGTH, WEBHOOK_MAX_BYTES } from '../channels/webhook.ts'
import { HOME_ID, type Env } from '../env.ts'
import { ApiError, badRequest, call, json, notFound, respond, unauthorized } from './http.ts'

const HOOK_PATH = new URLPattern({ pathname: '/hooks/:robotId/:key' })

export const isHookPath = (path: string): boolean => path.startsWith('/hooks/')

// An unknown Robot and a wrong key look the same.
const wrongKey = () => unauthorized('wrong webhook key')
const tooLarge = () => new ApiError({ status: 413, message: `the body is larger than ${WEBHOOK_MAX_BYTES / 1024} KB` })

/** The request body, or null when it is larger than the limit (read no further than the chunk that passes it). */
async function boundedBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > WEBHOOK_MAX_BYTES) return null
  if (request.body === null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > WEBHOOK_MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export const hookChannel = (request: Request, env: Env): Effect.Effect<Response> => respond(Effect.gen(function* () {
  const match = HOOK_PATH.exec(request.url)
  if (match === null) return yield* Effect.fail(notFound('no such endpoint'))
  if (request.method !== 'POST') return yield* Effect.fail(new ApiError({ status: 405, message: 'POST the event to this address' }))
  const { robotId, key } = match.pathname.groups as { robotId: string; key: string }
  const known = yield* call(() => env.HOME.getByName(HOME_ID).entry(robotId))
  if (known === undefined) return yield* Effect.fail(wrongKey())
  const robot = env.ROBOT.getByName(robotId)
  if (!(yield* call(() => robot.webhookAccepts(key)))) return yield* Effect.fail(wrongKey())
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null
  if (idempotencyKey !== null && idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return yield* Effect.fail(badRequest(`the Idempotency-Key is longer than ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`))
  }
  const bytes = yield* call(() => boundedBody(request))
  if (bytes === null) return yield* Effect.fail(tooLarge())
  const body = yield* Effect.try({
    try: () => new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    catch: () => new ApiError({ status: 415, message: 'send JSON or text' }),
  })
  const { accepted } = yield* call(() => robot.receiveWebhook(key, { contentType: request.headers.get('content-type') ?? '', body, idempotencyKey }))
  if (!accepted) return yield* Effect.fail(wrongKey())
  return json({ ok: true }, 202)
}))
