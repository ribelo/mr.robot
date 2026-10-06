/**
 * One Member (a person): profile, preferences, Member files (USER.md and
 * PROACTIVE_PREFERENCES.md, mounted read-only into each of their Robots), and the
 * Member's private secrets, Provider credentials, push subscriptions and usage.
 */
import { DurableObject } from 'cloudflare:workers'
import * as Effect from 'effect/Effect'
import type { ProviderView, QuietHours } from '@mr-robot/protocol'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import { HOME_ID, type Env } from '../env.ts'
import { makeVault, type VaultShape } from '../platform/vault.ts'
import { finishPasted, pollDevice, refreshTokens, startFlow, type FlowStart, type OAuthTokens, type PendingFlow } from '../providers/oauth.ts'
import { MEMBER_FILES } from '../workspace/templates.ts'

export type MemberFileName = 'USER.md' | 'PROACTIVE_PREFERENCES.md'
export const MEMBER_FILE_NAMES: readonly MemberFileName[] = ['USER.md', 'PROACTIVE_PREFERENCES.md']

export interface MemberProfile {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly timeZone: string
  readonly quietHours: QuietHours | null
}

export class Member extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS member_file (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS credential (
      provider TEXT PRIMARY KEY, kind TEXT NOT NULL, sealed TEXT NOT NULL, shared INTEGER NOT NULL, expires INTEGER, updated_at INTEGER NOT NULL
    )`)
  }

  private credentialVault(): VaultShape {
    return makeVault(this.env.DATA_KEY, 'credentials')
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  async init(input: { id: string; email: string; name: string }): Promise<MemberProfile> {
    const existing = this.get<MemberProfile>('profile')
    if (existing !== undefined) return existing
    const profile: MemberProfile = { ...input, timeZone: 'Europe/Warsaw', quietHours: null }
    this.ctx.storage.transactionSync(() => {
      this.set('profile', profile)
      for (const name of MEMBER_FILE_NAMES) {
        this.sql.exec(
          'INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
          name, MEMBER_FILES[name].replace('{{name}}', input.name), Date.now(),
        )
      }
    })
    return profile
  }

  profile(): MemberProfile {
    const profile = this.get<MemberProfile>('profile')
    if (profile === undefined) throw new Error('member is not initialised')
    return profile
  }

  updateProfile(patch: { name?: string; timeZone?: string; quietHours?: QuietHours | null }): MemberProfile {
    const next = { ...this.profile(), ...patch }
    this.set('profile', next)
    return next
  }

  // ---------------------------------------------------------------- Member files (robot-mj7v)

  file(name: MemberFileName): string {
    return this.sql.exec<{ content: string }>('SELECT content FROM member_file WHERE name = ?', name).toArray()[0]?.content ?? ''
  }

  files(): Record<MemberFileName, string> {
    return { 'USER.md': this.file('USER.md'), 'PROACTIVE_PREFERENCES.md': this.file('PROACTIVE_PREFERENCES.md') }
  }

  /** Only the Member writes their files, directly or by approving a Robot's proposal. */
  writeFile(name: MemberFileName, content: string): void {
    this.sql.exec(
      'INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      name, content, Date.now(),
    )
  }

  // ---------------------------------------------------------------- Provider credentials (robot-dic7, robot-lzu3, robot-7v9s)

  providers(): ProviderView[] {
    return this.sql.exec<{ provider: ProviderId; kind: 'api-key' | 'oauth'; shared: number; expires: number | null; updated_at: number }>(
      'SELECT provider, kind, shared, expires, updated_at FROM credential ORDER BY provider',
    ).toArray().map((row) => ({
      provider: row.provider,
      kind: row.kind,
      shared: row.shared === 1,
      connectedAt: row.updated_at,
      ownerId: this.profile().id,
      ownerName: this.profile().name,
    }))
  }

  async setApiKey(provider: ProviderId, key: string, shared: boolean): Promise<void> {
    const sealed = await Effect.runPromise(this.credentialVault().seal(JSON.stringify({ key })))
    this.saveCredential(provider, 'api-key', sealed, shared, null)
    await this.publishSharing(provider, shared)
  }

  async startOAuth(provider: 'openai' | 'anthropic'): Promise<Omit<FlowStart, 'flow'>> {
    const start = await Effect.runPromise(startFlow(provider, Date.now()))
    this.set(`oauth-flow:${provider}`, start.flow)
    return { url: start.url, ...(start.userCode === undefined ? {} : { userCode: start.userCode }) }
  }

  /**
   * Finish a sign-in. OpenAI polls the device flow once (false while the Member has not
   * confirmed yet); Anthropic exchanges the pasted code.
   */
  async finishOAuth(provider: 'openai' | 'anthropic', pasted: string | undefined, shared: boolean): Promise<boolean> {
    const flow = this.get<PendingFlow>(`oauth-flow:${provider}`)
    if (flow === undefined || flow.provider !== provider) throw new Error('start the sign-in first')
    if (Date.now() - flow.createdAt > 15 * 60_000) throw new Error('the sign-in expired; start again')
    const tokens = flow.provider === 'openai'
      ? await Effect.runPromise(pollDevice(flow))
      : await Effect.runPromise(finishPasted(flow, pasted ?? ''))
    if (tokens === undefined) return false
    await this.saveTokens(provider, tokens, shared)
    this.delete(`oauth-flow:${provider}`)
    await this.publishSharing(provider, shared)
    return true
  }

  async setShared(provider: ProviderId, shared: boolean): Promise<void> {
    this.sql.exec('UPDATE credential SET shared = ? WHERE provider = ?', shared ? 1 : 0, provider)
    await this.publishSharing(provider, shared)
  }

  async removeCredential(provider: ProviderId): Promise<void> {
    this.sql.exec('DELETE FROM credential WHERE provider = ?', provider)
    await this.publishSharing(provider, false)
  }

  /**
   * The current credential, refreshed when its access token is about to expire. A request on
   * behalf of another Member's Robot (`forHome`) gets only a credential shared with the Home.
   */
  async credential(provider: ProviderId, forHome: boolean): Promise<ProviderCredential | null> {
    const row = this.sql.exec<{ kind: 'api-key' | 'oauth'; sealed: string; shared: number }>(
      'SELECT kind, sealed, shared FROM credential WHERE provider = ?', provider,
    ).toArray()[0]
    if (row === undefined || (forHome && row.shared !== 1)) return null
    const data = JSON.parse(await Effect.runPromise(this.credentialVault().open(row.sealed))) as { key?: string } & Partial<OAuthTokens>
    if (row.kind === 'api-key') return { kind: 'api-key', key: data.key ?? '' }
    let tokens = data as OAuthTokens
    const expires = this.sql.exec<{ expires: number | null }>('SELECT expires FROM credential WHERE provider = ?', provider).one().expires ?? tokens.expires
    if (expires <= Date.now()) {
      tokens = await this.refreshOnce(provider as 'openai' | 'anthropic', tokens)
    }
    return { kind: 'oauth', access: tokens.access, ...(tokens.accountId === undefined ? {} : { accountId: tokens.accountId }) }
  }

  private refreshing = new Map<string, Promise<OAuthTokens>>()

  /** One refresh at a time per Provider: the refresh token rotates, a second refresh would fail. */
  private refreshOnce(provider: 'openai' | 'anthropic', tokens: OAuthTokens): Promise<OAuthTokens> {
    const running = this.refreshing.get(provider)
    if (running !== undefined) return running
    const shared = this.sql.exec<{ shared: number }>('SELECT shared FROM credential WHERE provider = ?', provider).toArray()[0]?.shared === 1
    const next = Effect.runPromise(refreshTokens(provider, tokens))
      .then(async (fresh) => {
        await this.saveTokens(provider, fresh, shared)
        return fresh
      })
      .finally(() => this.refreshing.delete(provider))
    this.refreshing.set(provider, next)
    return next
  }

  private async saveTokens(provider: ProviderId, tokens: OAuthTokens, shared: boolean): Promise<void> {
    const sealed = await Effect.runPromise(this.credentialVault().seal(JSON.stringify(tokens)))
    this.saveCredential(provider, 'oauth', sealed, shared, tokens.expires)
  }

  private saveCredential(provider: ProviderId, kind: 'api-key' | 'oauth', sealed: string, shared: boolean, expires: number | null): void {
    this.sql.exec(
      `INSERT INTO credential (provider, kind, sealed, shared, expires, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider) DO UPDATE SET kind = excluded.kind, sealed = excluded.sealed, shared = excluded.shared,
         expires = excluded.expires, updated_at = excluded.updated_at`,
      provider, kind, sealed, shared ? 1 : 0, expires, Date.now(),
    )
  }

  private async publishSharing(provider: ProviderId, shared: boolean): Promise<void> {
    await this.env.HOME.getByName(HOME_ID).credentialShared(this.profile().id, provider, shared)
  }

  // ---------------------------------------------------------------- small values

  protected get<T>(key: string): T | undefined {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', key).toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.v) as T)
  }

  protected set(key: string, value: unknown): void {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
  }

  protected delete(key: string): void {
    this.sql.exec('DELETE FROM kv WHERE k = ?', key)
  }
}