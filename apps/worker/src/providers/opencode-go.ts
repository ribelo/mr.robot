/**
 * OpenCode Go (ticket 19): every model of the offer through one rotating key pool.
 * The rotation follows the DSH opencode-go-session plugin (~/projects/ribelo/dsh/opencode-go-session,
 * src/rotation.ts): a quota or authentication failure moves on to the next key and promotes it
 * unless the person chose another key meanwhile; a session sticks to the key that last worked
 * for it; Responses requests whose encrypted reasoning was issued to another key are retried
 * without that reasoning. The pool itself lives encrypted in the Member DO.
 */
import { LlmError, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import { AnthropicAdapter } from './anthropic.ts'
import { CodexAdapter } from './codex.ts'
import { ChatCompletionsAdapter } from './openai-chat.ts'
import { OPENCODE_GO_MODELS } from './opencode-go-models.ts'

export const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go/v1'

export interface OpencodeKey {
  readonly id: string
  readonly key: string
}

/** The person's key pool, as the Robot sees it through the Member DO. */
export interface OpencodePool {
  /** Keys in the order to try for this session: its sticky key or the active one first. */
  candidates(sessionId: string | null): Promise<{ keys: readonly OpencodeKey[]; activeId: string | null }>
  /** Make `id` active if the active key is still `expectedActiveId` (a manual choice wins). */
  promote(expectedActiveId: string, id: string): Promise<void>
  /** Remember the key that served this session. */
  stick(sessionId: string, id: string): Promise<void>
}

async function readError(response: Response): Promise<{ type?: string; message?: string }> {
  try {
    const body = (await response.clone().json()) as Record<string, unknown>
    const nested = body['error']
    const source = (nested !== null && typeof nested === 'object' ? nested : body) as Record<string, unknown>
    return {
      ...(typeof source['type'] === 'string' ? { type: source['type'] } : {}),
      ...(typeof source['message'] === 'string' ? { message: source['message'] } : {}),
    }
  } catch {
    return {}
  }
}

const isQuotaType = (type?: string) => type !== undefined && (type === 'MonthlyLimitError' || type === 'CreditsError' || /LimitExceeded/i.test(type) || /FreeTier/i.test(type))
const isQuotaText = (message?: string) => message !== undefined && /insufficient (?:account )?(?:balance|funds)|budget exceeded|monthly (spending )?limit|account budget|limit exceeded/i.test(message)

/** Why a key cannot serve this request, or undefined when the response is the key's answer. */
export async function keyFailure(response: Response): Promise<'quota' | 'auth' | 'mismatch' | undefined> {
  if (response.ok) return undefined
  const { type, message } = await readError(response)
  const text = message?.trim()
  const quotaStatus = response.status === 401 || response.status === 402 || response.status === 429 || (response.status === 403 && isQuotaType(type))
  if (text && quotaStatus && (isQuotaType(type) || isQuotaText(text))) return 'quota'
  if (response.status === 401 && type === 'AuthenticationError') return 'auth'
  if (response.status === 400 && /encrypted_content.*was not issued to this caller/i.test(text ?? '')) return 'mismatch'
  return undefined
}

function withKey(request: Request, key: string): Request {
  const headers = new Headers(request.headers)
  if (headers.has('x-api-key')) headers.set('x-api-key', key)
  else headers.set('authorization', `Bearer ${key}`)
  // Never follow a redirect with a managed key: a 3xx comes back to the caller as is.
  return new Request(request.clone(), { headers, redirect: 'manual' })
}

async function withoutEncryptedReasoning(request: Request): Promise<Request | undefined> {
  if (!new URL(request.url).pathname.endsWith('/responses')) return undefined
  try {
    const body = (await request.clone().json()) as Record<string, unknown>
    const input = body['input']
    if (!Array.isArray(input)) return undefined
    const filtered = input.filter((item) => !(item !== null && typeof item === 'object' && item.type === 'reasoning' && typeof item.encrypted_content === 'string'))
    if (filtered.length === input.length) return undefined
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    return new Request(request.clone(), { body: JSON.stringify({ ...body, input: filtered }), headers })
  } catch {
    return undefined
  }
}

/** A fetch that tries the pool's keys in order; see the module comment for the rules. */
export function rotatingFetch(pool: OpencodePool, upstream: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const sessionId = request.headers.get('x-opencode-session')
    const { keys, activeId } = await pool.candidates(sessionId)
    if (keys.length === 0) throw new LlmError('Add an OpenCode Go API key under Providers.', 'MISSING_CREDENTIAL')
    let last: Response | undefined
    let previousActive = activeId
    let rotateActive = false
    let allMismatches = true
    for (const entry of keys) {
      request.signal.throwIfAborted()
      if (last !== undefined) {
        await last.body?.cancel()
        if (rotateActive && previousActive !== null) {
          await pool.promote(previousActive, entry.id)
          previousActive = entry.id
        }
      }
      const response = await upstream(withKey(request, entry.key))
      const failure = await keyFailure(response)
      last = response
      if (failure === undefined) {
        if (response.ok && sessionId !== null) await pool.stick(sessionId, entry.id)
        return response
      }
      allMismatches &&= failure === 'mismatch'
      rotateActive = failure === 'quota' || failure === 'auth'
    }
    if (last !== undefined && allMismatches) {
      const stripped = await withoutEncryptedReasoning(request)
      const first = keys[0]!
      if (stripped !== undefined) {
        await last.body?.cancel()
        const response = await upstream(withKey(stripped, first.key))
        if (response.ok && sessionId !== null) await pool.stick(sessionId, first.id)
        return response
      }
    }
    return last!
  }) as typeof fetch
}

/** The adapter for one OpenCode Go model, on the wire format that model speaks. */
export function opencodeGoAdapter(model: string, pool: OpencodePool): LlmAdapter {
  const entry = OPENCODE_GO_MODELS.find((candidate) => candidate.id === model)
  if (entry === undefined) throw new LlmError(`OpenCode Go has no model "${model}"`, 'MODEL_NOT_FOUND')
  const fetcher = rotatingFetch(pool)
  // The pool replaces this placeholder with the chosen key; the session header is required by OpenCode Go.
  const headers = (style: 'bearer' | 'x-api-key') => async (options: { sessionId?: unknown }) => ({
    ...(style === 'bearer' ? { authorization: 'Bearer pool' } : { 'x-api-key': 'pool' }),
    ...(options.sessionId === undefined ? {} : { 'x-opencode-session': String(options.sessionId) }),
  })
  switch (entry.wire) {
    case 'chat':
      return new ChatCompletionsAdapter({ name: 'OpenCode Go', url: `${OPENCODE_GO_BASE}/chat/completions`, contextWindow: entry.contextWindow, headers: headers('bearer'), fetch: fetcher })
    case 'anthropic':
      return new AnthropicAdapter({ url: `${OPENCODE_GO_BASE}/messages`, claudeCode: false, headers: headers('x-api-key'), fetch: fetcher }, entry.contextWindow)
    case 'responses':
      return new CodexAdapter({ url: `${OPENCODE_GO_BASE}/responses`, headers: headers('bearer'), fetch: fetcher }, entry.contextWindow)
  }
}
