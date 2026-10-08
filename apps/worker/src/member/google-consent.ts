/**
 * A Member's Google consents (v1.5 ticket 02): the one-time state of a consent in progress, the
 * connection it creates or repairs, and fresh access tokens for each use (one refresh at a time).
 */
import * as Effect from 'effect/Effect'
import { describeConnectorFailure } from '../connectors/connector.ts'
import { consentUrl, exchangeCode, isGoogleService, refreshAccess, servicesFromScopes, type GoogleClient, type GoogleService } from '../connectors/google/oauth.ts'
import type { ConnectionMeta, ConnectionStore, OwnConnection } from './connections.ts'

const STATE_TTL_MS = 15 * 60_000
/** Refresh a little before Google's expiry, so a call never starts with a token about to die. */
const EARLY_MS = 120_000

export class GoogleConsentFailed extends Error {}

type Use = { connection: OwnConnection; secrets: Record<string, string>; meta: ConnectionMeta }

export class GoogleConsents {
  private readonly refreshing = new Map<string, Promise<Use>>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly store: ConnectionStore,
    private readonly client: () => Promise<GoogleClient | null>,
    private readonly fetch: typeof globalThis.fetch,
  ) {
    sql.exec('CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, services TEXT NOT NULL, shared INTEGER NOT NULL, reconnect TEXT, created_at INTEGER NOT NULL)')
  }

  /** Google's consent URL for the chosen services; reconnect repairs an existing connection. */
  async start(origin: string, services: readonly string[], shared: boolean, reconnect: string | null): Promise<string> {
    const client = await this.client()
    if (client === null) throw new GoogleConsentFailed('the Home admin has not set up the Google OAuth client yet')
    const repaired = reconnect === null ? undefined : this.store.get(reconnect)
    if (reconnect !== null && repaired === undefined) throw new GoogleConsentFailed('no such connection of yours')
    const chosen = (repaired?.services ?? services).filter(isGoogleService)
    if (chosen.length === 0) throw new GoogleConsentFailed('choose at least one service')
    const state = crypto.randomUUID()
    const now = Date.now()
    this.sql.exec('DELETE FROM oauth_state WHERE created_at < ?', now - STATE_TTL_MS)
    this.sql.exec('INSERT INTO oauth_state (state, services, shared, reconnect, created_at) VALUES (?, ?, ?, ?, ?)', state, JSON.stringify(chosen), (repaired?.shared ?? shared) ? 1 : 0, reconnect, now)
    return consentUrl(client, origin, chosen, state, repaired?.account)
  }

  /** Google sent the person back: the code becomes a stored connection (cn-aq2a). */
  async finish(origin: string, code: string, state: string): Promise<OwnConnection> {
    const row = this.sql.exec<{ services: string; shared: number; reconnect: string | null; created_at: number }>('SELECT services, shared, reconnect, created_at FROM oauth_state WHERE state = ?', state).toArray()[0]
    this.sql.exec('DELETE FROM oauth_state WHERE state = ?', state)
    if (row === undefined || row.created_at < Date.now() - STATE_TTL_MS) throw new GoogleConsentFailed('this sign-in expired or was already used; start again from your connections')
    const client = await this.client()
    if (client === null) throw new GoogleConsentFailed('the Home admin has not set up the Google OAuth client yet')
    const outcome = await Effect.runPromise(Effect.result(exchangeCode(this.fetch, client, origin, code, Date.now())))
    if (outcome._tag === 'Failure') throw new GoogleConsentFailed(`Google did not complete the sign-in: ${describeConnectorFailure(outcome.failure)}`)
    const granted = outcome.success
    // What Google actually granted: the person may have unticked a service on its screen (cn-lzqh).
    const services: GoogleService[] = granted.scope === null ? (JSON.parse(row.services) as GoogleService[]) : servicesFromScopes(granted.scope)
    const secrets = { accessToken: granted.accessToken, refreshToken: granted.refreshToken! }
    const meta = { expiresAt: granted.expiresAt }
    const existing = (row.reconnect === null ? undefined : this.store.get(row.reconnect))
      ?? this.store.list().find((connection) => connection.kind === 'google' && connection.account.toLowerCase() === granted.email.toLowerCase())
    if (existing !== undefined) {
      return (await this.store.update(existing.id, { account: granted.email, services, status: 'connected', statusNote: null, secrets, meta }))!
    }
    return this.store.add({ kind: 'google', label: granted.email, account: granted.email, services, shared: row.shared === 1, meta, secrets })
  }

  /** A use of a Google connection with an access token that is valid now (cn-j1la). */
  fresh(use: Use): Promise<Use> {
    const expiresAt = typeof use.meta['expiresAt'] === 'number' ? use.meta['expiresAt'] : 0
    if (expiresAt > Date.now() + EARLY_MS) return Promise.resolve(use)
    const id = use.connection.id
    let pending = this.refreshing.get(id)
    if (pending === undefined) {
      pending = this.refresh(use).finally(() => this.refreshing.delete(id))
      this.refreshing.set(id, pending)
    }
    return pending
  }

  private async refresh(use: Use): Promise<Use> {
    const client = await this.client()
    const refreshToken = use.secrets['refreshToken']
    if (client === null || refreshToken === undefined) return use
    const outcome = await Effect.runPromise(Effect.result(refreshAccess(this.fetch, client, refreshToken, Date.now())))
    if (outcome._tag === 'Failure') {
      // A refused refresh needs the person: the row says so and offers Reconnect (cn-9s7r).
      if (outcome.failure._tag === 'ConnectorUnauthorized') await this.store.update(use.connection.id, { status: 'needs-reconsent', statusNote: outcome.failure.message })
      return use
    }
    const secrets = { ...use.secrets, accessToken: outcome.success.accessToken, ...(outcome.success.refreshToken === null ? {} : { refreshToken: outcome.success.refreshToken }) }
    const meta = { ...use.meta, expiresAt: outcome.success.expiresAt }
    const connection = (await this.store.update(use.connection.id, { secrets, meta, ...(use.connection.status === 'connected' ? {} : { status: 'connected', statusNote: null }) }))!
    return { connection, secrets, meta }
  }
}
