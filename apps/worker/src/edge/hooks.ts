/**
 * The webhook Channel's door (v1.6 ticket 07, cd-pqt8, cd-q7mc, cd-s07d): POST /hooks/<robotId>/<key>.
 * It is outside the Access login, so the key is the credential: a wrong key answers 401, an oversized
 * body 413, and neither wakes the Robot. The Robot is told once per Idempotency-Key.
 */
import { WEBHOOK_MAX_BYTES } from '../channels/webhook.ts'
import { HOME_ID, type Env } from '../env.ts'
import { json } from './http.ts'

const HOOK_PATH = new URLPattern({ pathname: '/hooks/:robotId/:key' })

export const isHookPath = (path: string): boolean => path.startsWith('/hooks/')

/** The request body, or null when it is larger than the limit (read no further than one byte past it). */
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

export async function hookChannel(request: Request, env: Env): Promise<Response> {
  const match = HOOK_PATH.exec(request.url)
  if (match === null) return json({ error: 'no such endpoint' }, 404)
  if (request.method !== 'POST') return json({ error: 'POST the event to this address' }, 405)
  const { robotId, key } = match.pathname.groups as { robotId: string; key: string }
  // An unknown Robot and a wrong key look the same.
  const known = (await env.HOME.getByName(HOME_ID).entry(robotId)) !== undefined
  const robot = known ? env.ROBOT.getByName(robotId) : undefined
  if (robot === undefined || !(await robot.webhookAccepts(key))) return json({ error: 'wrong webhook key' }, 401)
  const bytes = await boundedBody(request)
  if (bytes === null) return json({ error: `the body is larger than ${WEBHOOK_MAX_BYTES / 1024} KB` }, 413)
  const body = (() => {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    } catch {
      return null
    }
  })()
  if (body === null) return json({ error: 'send JSON or text' }, 415)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null
  const { accepted } = await robot.receiveWebhook(key, { contentType: request.headers.get('content-type') ?? '', body, idempotencyKey })
  return accepted ? json({ ok: true }, 202) : json({ error: 'wrong webhook key' }, 401)
}
