/**
 * Google OAuth 2.0 web flow (v1.5 ticket 02, cn-aq2a, cn-lzqh, cn-j1la, cn-9s7r): the consent URL for
 * the services a person picks, the code exchange, the account's address, and token refresh. The Home's
 * OAuth client (one per Home, set up once by the admin) signs every call.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorUnauthorized, request, type ConnectorFailure } from '../connector.ts'

export const GOOGLE_SERVICES = ['gmail', 'gmail-send', 'calendar', 'drive', 'contacts'] as const
export type GoogleService = typeof GOOGLE_SERVICES[number]

const SCOPE = 'https://www.googleapis.com/auth/'
const SCOPES: Record<GoogleService, readonly string[]> = {
  gmail: [`${SCOPE}gmail.modify`],
  'gmail-send': [`${SCOPE}gmail.send`],
  calendar: [`${SCOPE}calendar`],
  drive: [`${SCOPE}drive`, `${SCOPE}documents`, `${SCOPE}spreadsheets`],
  contacts: [`${SCOPE}contacts.readonly`],
}
const IDENTITY = ['openid', 'email']

export interface GoogleClient {
  readonly clientId: string
  readonly clientSecret: string
}

export const isGoogleService = (value: string): value is GoogleService => (GOOGLE_SERVICES as readonly string[]).includes(value)

/** The scopes to ask for: identity plus each chosen service's scopes. */
export function scopesFor(services: readonly GoogleService[]): string[] {
  return [...new Set([...IDENTITY, ...services.flatMap((service) => SCOPES[service])])]
}

/** The services a granted scope list actually covers (the person may untick boxes on Google's screen). */
export function servicesFromScopes(granted: string): GoogleService[] {
  const scopes = new Set(granted.split(/\s+/))
  return GOOGLE_SERVICES.filter((service) => SCOPES[service].every((scope) => scopes.has(scope)))
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/connections/google/oauth/callback`
}

/** Google's consent screen: offline access for a refresh token, consent every time so one is always issued. */
export function consentUrl(client: GoogleClient, origin: string, services: readonly GoogleService[], state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: callbackUrl(origin),
    response_type: 'code',
    scope: scopesFor(services).join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (loginHint !== undefined) params.set('login_hint', loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
})
const UserInfo = Schema.Struct({ email: Schema.String })

/** A refresh token Google no longer honours answers 400 invalid_grant: that is a consent problem, not a failure. */
const refused = (status: number, body: unknown): string | null =>
  status === 400 && body !== null && typeof body === 'object' && (body as Record<string, unknown>)['error'] === 'invalid_grant'
    ? String((body as Record<string, unknown>)['error_description'] ?? 'the refresh token was revoked or expired')
    : null

export interface GoogleTokens {
  readonly accessToken: string
  readonly refreshToken: string | null
  readonly expiresAt: number
  readonly scope: string | null
}

const tokens = (body: typeof TokenResponse.Type, now: number): GoogleTokens => ({
  accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresAt: now + body.expires_in * 1000, scope: body.scope ?? null,
})

/** The callback's code becomes tokens, and the account's address. */
export function exchangeCode(fetch: typeof globalThis.fetch, client: GoogleClient, origin: string, code: string, now: number): Effect.Effect<GoogleTokens & { readonly email: string }, ConnectorFailure> {
  return Effect.gen(function* () {
    const body = yield* request(fetch, { method: 'POST', url: 'https://oauth2.googleapis.com/token', form: { code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: callbackUrl(origin), grant_type: 'authorization_code' } }, TokenResponse, refused)
    if (body.refresh_token === undefined) return yield* new ConnectorUnauthorized({ message: 'Google issued no refresh token; connect again and accept every screen' })
    const user = yield* request(fetch, { method: 'GET', url: 'https://openidconnect.googleapis.com/v1/userinfo', headers: { authorization: `Bearer ${body.access_token}` } }, UserInfo)
    return { ...tokens(body, now), email: user.email }
  })
}

/** A fresh access token from the refresh token (cn-j1la). */
export function refreshAccess(fetch: typeof globalThis.fetch, client: GoogleClient, refreshToken: string, now: number): Effect.Effect<GoogleTokens, ConnectorFailure> {
  return Effect.map(
    request(fetch, { method: 'POST', url: 'https://oauth2.googleapis.com/token', form: { refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' } }, TokenResponse, refused),
    (body) => tokens(body, now),
  )
}
