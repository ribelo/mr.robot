/**
 * Subscription sign-in (robot-lzu3) with the constants of the owner's DSH plugins
 * (~/projects/ribelo/dsh/openai-codex, claude-subscription via pi-ai):
 * - OpenAI (ChatGPT/Codex): device-code flow; the Member types a short code at auth.openai.com.
 * - Anthropic (Claude): authorization code with PKCE; the Member pastes the URL the browser
 *   landed on (the registered redirect is the CLI's localhost callback).
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

export type SubscriptionProvider = 'openai' | 'anthropic'

export class OAuthError extends Data.TaggedError('OAuthError')<{ readonly message: string; readonly cause?: unknown }> {}

export interface OAuthTokens {
  readonly access: string
  readonly refresh: string
  /** Epoch ms after which the access token is treated as expired (5 minutes early). */
  readonly expires: number
  readonly accountId?: string
}

export type PendingFlow =
  | { readonly provider: 'openai'; readonly deviceAuthId: string; readonly userCode: string; readonly createdAt: number }
  | { readonly provider: 'anthropic'; readonly verifier: string; readonly createdAt: number }

export interface FlowStart {
  readonly flow: PendingFlow
  /** Where the Member signs in. */
  readonly url: string
  /** OpenAI: the code to type there. */
  readonly userCode?: string
}

/** Client ids are deploy-level configuration (Workers Secrets), set in infra/stack.ts. */
export interface OAuthClients {
  readonly openai: string
  readonly anthropic: string
}

const OPENAI = {
  token: 'https://auth.openai.com/oauth/token',
  deviceUserCode: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  deviceToken: 'https://auth.openai.com/api/accounts/deviceauth/token',
  verification: 'https://auth.openai.com/codex/device',
  deviceRedirect: 'https://auth.openai.com/deviceauth/callback',
}

const ANTHROPIC = {
  authorize: 'https://claude.ai/oauth/authorize',
  token: 'https://platform.claude.com/v1/oauth/token',
  redirect: 'http://localhost:53692/callback',
  scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const fail = (fallback: string) => (cause: unknown) => new OAuthError({ message: cause instanceof Error ? cause.message : fallback, cause })

export function startFlow(clients: OAuthClients, provider: SubscriptionProvider, now: number): Effect.Effect<FlowStart, OAuthError> {
  return Effect.tryPromise({
    try: async (): Promise<FlowStart> => {
      if (provider === 'openai') {
        const response = await fetch(OPENAI.deviceUserCode, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clients.openai }),
        })
        if (!response.ok) throw new Error(`OpenAI device sign-in is unavailable (${response.status})`)
        const body = (await response.json()) as { device_auth_id?: string; user_code?: string }
        if (typeof body.device_auth_id !== 'string' || typeof body.user_code !== 'string') throw new Error('OpenAI returned a malformed device code')
        return {
          flow: { provider, deviceAuthId: body.device_auth_id, userCode: body.user_code, createdAt: now },
          url: OPENAI.verification,
          userCode: body.user_code,
        }
      }
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
      const url = new URL(ANTHROPIC.authorize)
      url.search = new URLSearchParams({
        code: 'true',
        client_id: clients.anthropic,
        response_type: 'code',
        redirect_uri: ANTHROPIC.redirect,
        scope: ANTHROPIC.scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: verifier,
      }).toString()
      return { flow: { provider, verifier, createdAt: now }, url: url.toString() }
    },
    catch: fail('cannot start the sign-in'),
  })
}

/** OpenAI device flow: one poll. Undefined while the Member has not finished. */
export function pollDevice(clients: OAuthClients, flow: Extract<PendingFlow, { provider: 'openai' }>): Effect.Effect<OAuthTokens | undefined, OAuthError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(OPENAI.deviceToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_auth_id: flow.deviceAuthId, user_code: flow.userCode }),
      })
      if (response.status === 403 || response.status === 404) return undefined
      const body = (await response.json().catch(() => ({}))) as { authorization_code?: string; code_verifier?: string; error?: unknown; code?: string }
      if (!response.ok) {
        const code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : ''
        if (code === 'deviceauth_authorization_pending' || code === 'slow_down') return undefined
        throw new Error(`OpenAI sign-in failed (${response.status})`)
      }
      if (typeof body.authorization_code !== 'string' || typeof body.code_verifier !== 'string') throw new Error('OpenAI returned a malformed device token')
      return tokenRequest('openai', {
        grant_type: 'authorization_code',
        client_id: clients.openai,
        code: body.authorization_code,
        code_verifier: body.code_verifier,
        redirect_uri: OPENAI.deviceRedirect,
      })
    },
    catch: fail('the sign-in failed'),
  })
}

/** Anthropic: finish with what the Member pasted (full URL, "code#state", or the bare code). */
export function finishPasted(clients: OAuthClients, flow: Extract<PendingFlow, { provider: 'anthropic' }>, pasted: string): Effect.Effect<OAuthTokens, OAuthError> {
  return Effect.suspend(() => {
    const { code, state } = readPasted(pasted)
    if (state !== undefined && state !== flow.verifier) return Effect.fail(new OAuthError({ message: 'this code belongs to a different sign-in; start again' }))
    return Effect.tryPromise({
      try: () => tokenRequest('anthropic', {
        grant_type: 'authorization_code',
        client_id: clients.anthropic,
        code,
        state: flow.verifier,
        redirect_uri: ANTHROPIC.redirect,
        code_verifier: flow.verifier,
      }),
      catch: fail('the sign-in failed'),
    })
  })
}

export function readPasted(pasted: string): { code: string; state?: string } {
  const text = pasted.trim()
  let code: string | null = null
  let state: string | null = null
  if (/^https?:\/\//.test(text)) {
    const url = new URL(text)
    code = url.searchParams.get('code')
    state = url.searchParams.get('state')
  } else if (text.includes('code=')) {
    const params = new URLSearchParams(text)
    code = params.get('code')
    state = params.get('state')
  } else if (text.includes('#')) {
    const [left, right] = text.split('#', 2)
    code = left ?? null
    state = right ?? null
  } else {
    code = text
  }
  if (code === null || code === '') throw new OAuthError({ message: 'no authorization code in what was pasted' })
  return { code, ...(state === null ? {} : { state }) }
}

/** Refresh without the Member: providers rotate refresh tokens, so the new pair replaces the old. */
export function refreshTokens(clients: OAuthClients, provider: SubscriptionProvider, tokens: OAuthTokens): Effect.Effect<OAuthTokens, OAuthError> {
  return Effect.tryPromise({
    try: async () => {
      const next = await tokenRequest(provider, { grant_type: 'refresh_token', client_id: clients[provider], refresh_token: tokens.refresh })
      return next.accountId === undefined && tokens.accountId !== undefined ? { ...next, accountId: tokens.accountId } : next
    },
    catch: fail('refresh failed'),
  })
}

async function tokenRequest(provider: SubscriptionProvider, params: Record<string, string>): Promise<OAuthTokens> {
  const form = provider === 'openai'
  const response = await fetch(form ? OPENAI.token : ANTHROPIC.token, {
    method: 'POST',
    headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', accept: 'application/json' },
    body: form ? new URLSearchParams(params).toString() : JSON.stringify(params),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} token request failed (${response.status}): ${text.slice(0, 200)}`)
  const body = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') throw new Error('no tokens in the response')
  const accountId = provider === 'openai' ? chatgptAccountId(body.access_token) ?? chatgptAccountId(body.id_token ?? '') : undefined
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000 - 5 * 60_000,
    ...(accountId === undefined ? {} : { accountId }),
  }
}

function chatgptAccountId(jwt: string): string | undefined {
  try {
    const part = jwt.split('.')[1]
    if (part === undefined) return undefined
    const payload = JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
    return (payload['https://api.openai.com/auth'] as { chatgpt_account_id?: string } | undefined)?.chatgpt_account_id
  } catch {
    return undefined
  }
}
