/**
 * One Member (a person): profile, preferences, Member files (USER.md and
 * PROACTIVE_PREFERENCES.md, mounted read-only into each of their Robots), and the
 * Member's private secrets, Provider credentials, push subscriptions and usage.
 */
import { DurableObject } from 'cloudflare:workers'
import * as Effect from 'effect/Effect'
import type { NotificationKind, ProviderView, QuietHours } from '@mr-robot/protocol'
import { sendPush, type DeviceSubscription, type PushNotification } from '../platform/push.ts'
import { localDate, zonedTime } from '../robot/schedule.ts'
import type { ProviderCredential, ProviderId } from '../agent/providers.ts'
import { HOME_ID, type Env } from '../env.ts'
import { makeVault, type VaultShape } from '../platform/vault.ts'
import type { OpencodeKey } from '../providers/opencode-go.ts'
import { finishPasted, pollDevice, refreshTokens, startFlow, type FlowStart, type OAuthClients, type OAuthTokens, type PendingFlow } from '../providers/oauth.ts'
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
    sql.exec('CREATE TABLE IF NOT EXISTS secret (name TEXT PRIMARY KEY, sealed TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS usage (month TEXT NOT NULL, robot_id TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (month, robot_id)) WITHOUT ROWID')
    sql.exec('CREATE TABLE IF NOT EXISTS push_device (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS pending_notification (id INTEGER PRIMARY KEY AUTOINCREMENT, deliver_at INTEGER NOT NULL, notification TEXT NOT NULL)')
    sql.exec(`CREATE TABLE IF NOT EXISTS credential (
      provider TEXT PRIMARY KEY, kind TEXT NOT NULL, sealed TEXT NOT NULL, shared INTEGER NOT NULL, expires INTEGER, updated_at INTEGER NOT NULL
    )`)
  }

  private oauthClients(): OAuthClients {
    return { openai: this.env.OPENAI_OAUTH_CLIENT_ID, anthropic: this.env.ANTHROPIC_OAUTH_CLIENT_ID }
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
    const start = await Effect.runPromise(startFlow(this.oauthClients(), provider, Date.now()))
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
      ? await Effect.runPromise(pollDevice(this.oauthClients(), flow))
      : await Effect.runPromise(finishPasted(this.oauthClients(), flow, pasted ?? ''))
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
    if (provider === 'opencode-go') return null
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
    const next = Effect.runPromise(refreshTokens(this.oauthClients(), provider, tokens))
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

  // ---------------------------------------------------------------- private secrets (robot-vplt)

  private secretVault(): VaultShape {
    return makeVault(this.env.DATA_KEY, 'secrets')
  }

  async setSecret(name: string, value: string): Promise<void> {
    const sealed = await Effect.runPromise(this.secretVault().seal(value))
    this.sql.exec('INSERT INTO secret (name, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at', name, sealed, Date.now())
  }

  /** Plaintext of one private secret; only a Turn of this Member's own Robot asks for it. */
  async secret(name: string): Promise<string | null> {
    const row = this.sql.exec<{ sealed: string }>('SELECT sealed FROM secret WHERE name = ?', name).toArray()[0]
    return row === undefined ? null : Effect.runPromise(this.secretVault().open(row.sealed))
  }

  /** Remove a private secret and return its value (used when it moves to the Home). */
  async takeSecret(name: string): Promise<string | null> {
    const value = await this.secret(name)
    this.sql.exec('DELETE FROM secret WHERE name = ?', name)
    return value
  }

  secretNames(): Array<{ name: string; updatedAt: number }> {
    return this.sql.exec<{ name: string; updated_at: number }>('SELECT name, updated_at FROM secret ORDER BY name').toArray().map((row) => ({ name: row.name, updatedAt: row.updated_at }))
  }

  async sealedSecretForTest(name: string): Promise<string | undefined> {
    return this.sql.exec<{ sealed: string }>('SELECT sealed FROM secret WHERE name = ?', name).toArray()[0]?.sealed
  }

  // ---------------------------------------------------------------- usage (robot-6jqh)

  addUsage(month: string, robotId: string, inputTokens: number, outputTokens: number, costUsd: number): void {
    this.sql.exec(
      `INSERT INTO usage (month, robot_id, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (month, robot_id) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
      month, robotId, inputTokens, outputTokens, costUsd,
    )
  }

  usage(month: string): { inputTokens: number; outputTokens: number; costUsd: number; byRobot: Array<{ robotId: string; inputTokens: number; outputTokens: number; costUsd: number }> } {
    const rows = this.sql.exec<{ robot_id: string; input_tokens: number; output_tokens: number; cost_usd: number }>(
      'SELECT robot_id, input_tokens, output_tokens, cost_usd FROM usage WHERE month = ?', month,
    ).toArray().map((row) => ({ robotId: row.robot_id, inputTokens: row.input_tokens, outputTokens: row.output_tokens, costUsd: row.cost_usd }))
    return {
      inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
      byRobot: rows,
    }
  }

  // ---------------------------------------------------------------- OpenCode Go key pool (ticket 19)

  private async readPool(): Promise<{ keys: OpencodeKey[]; activeId: string | null }> {
    const row = this.sql.exec<{ sealed: string }>("SELECT sealed FROM credential WHERE provider = 'opencode-go'").toArray()[0]
    if (row === undefined) return { keys: [], activeId: null }
    return JSON.parse(await Effect.runPromise(this.credentialVault().open(row.sealed))) as { keys: OpencodeKey[]; activeId: string | null }
  }

  private async writePool(pool: { keys: OpencodeKey[]; activeId: string | null }, shared?: boolean): Promise<void> {
    const current = this.sql.exec<{ shared: number }>("SELECT shared FROM credential WHERE provider = 'opencode-go'").toArray()[0]
    const share = shared ?? current?.shared === 1
    if (pool.keys.length === 0) {
      this.sql.exec("DELETE FROM credential WHERE provider = 'opencode-go'")
      await this.publishSharing('opencode-go', false)
      return
    }
    const sealed = await Effect.runPromise(this.credentialVault().seal(JSON.stringify(pool)))
    this.saveCredential('opencode-go', 'api-key', sealed, share, null)
    if (current === undefined || shared !== undefined) await this.publishSharing('opencode-go', share)
  }

  /** Keys shown masked: never the value. */
  async opencodeKeys(): Promise<{ keys: Array<{ id: string; masked: string }>; activeId: string | null; shared: boolean }> {
    const pool = await this.readPool()
    const shared = this.sql.exec<{ shared: number }>("SELECT shared FROM credential WHERE provider = 'opencode-go'").toArray()[0]?.shared === 1
    return { keys: pool.keys.map(({ id, key }) => ({ id, masked: `••••${key.length > 8 ? key.slice(-4) : ''}` })), activeId: pool.activeId, shared }
  }

  async addOpencodeKey(raw: string, shared?: boolean): Promise<void> {
    const key = raw.trim().replace(/,+$/, '')
    if (!/^(?:sk-|oc_sk_)[A-Za-z0-9_-]+$/.test(key)) throw new Error('Enter an OpenCode API key without a Bearer prefix or spaces')
    await this.poolLock(async () => {
      const pool = await this.readPool()
      if (pool.keys.some((entry) => entry.key === key)) throw new Error('This key is already saved')
      const id = crypto.randomUUID()
      pool.keys.push({ id, key })
      pool.activeId ??= id
      await this.writePool(pool, shared)
    })
  }

  async activateOpencodeKey(id: string): Promise<void> {
    await this.poolLock(async () => {
      const pool = await this.readPool()
      if (!pool.keys.some((entry) => entry.id === id)) throw new Error('That key no longer exists')
      pool.activeId = id
      await this.writePool(pool)
    })
  }

  async removeOpencodeKey(id: string): Promise<void> {
    await this.poolLock(async () => {
      const pool = await this.readPool()
      pool.keys = pool.keys.filter((entry) => entry.id !== id)
      if (pool.activeId === id) pool.activeId = pool.keys[0]?.id ?? null
      await this.writePool(pool)
    })
  }

  /** Keys in the order a request should try them: the session's sticky key or the active one first. */
  async opencodeCandidates(sessionId: string | null, forHome: boolean): Promise<{ keys: OpencodeKey[]; activeId: string | null }> {
    const shared = this.sql.exec<{ shared: number }>("SELECT shared FROM credential WHERE provider = 'opencode-go'").toArray()[0]?.shared === 1
    if (forHome && !shared) return { keys: [], activeId: null }
    const pool = await this.readPool()
    const sticky = sessionId === null ? undefined : this.get<Record<string, string>>('opencode-sticky')?.[sessionId]
    const first = pool.keys.findIndex((entry) => entry.id === (sticky !== undefined && pool.keys.some((key) => key.id === sticky) ? sticky : pool.activeId))
    const keys = first < 0 ? pool.keys : [...pool.keys.slice(first), ...pool.keys.slice(0, first)]
    return { keys, activeId: pool.activeId }
  }

  async opencodePromote(expectedActiveId: string, id: string): Promise<void> {
    await this.poolLock(async () => {
      const pool = await this.readPool()
      if (pool.activeId !== expectedActiveId || !pool.keys.some((entry) => entry.id === id)) return
      pool.activeId = id
      await this.writePool(pool)
    })
  }

  opencodeStick(sessionId: string, id: string): void {
    const sticky = this.get<Record<string, string>>('opencode-sticky') ?? {}
    if (sticky[sessionId] === id) return
    const entries = Object.entries({ ...sticky, [sessionId]: id }).slice(-500)
    this.set('opencode-sticky', Object.fromEntries(entries))
  }

  private poolQueue: Promise<unknown> = Promise.resolve()

  /** Pool changes are read-modify-write across awaits: run them one at a time. */
  private poolLock<T>(change: () => Promise<T>): Promise<T> {
    const next = this.poolQueue.then(change, change)
    this.poolQueue = next.catch(() => undefined)
    return next
  }

  // ---------------------------------------------------------------- Web Push (robot-ajrp, robot-9xoj, robot-bden)

  addPushDevice(device: DeviceSubscription & { device?: string }): void {
    this.sql.exec(
      `INSERT INTO push_device (endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`,
      device.endpoint, device.keys.p256dh, device.keys.auth, device.device ?? '', Date.now(),
    )
  }

  removePushDevice(endpoint: string): void {
    this.sql.exec('DELETE FROM push_device WHERE endpoint = ?', endpoint)
  }

  pushDevices(): Array<{ endpoint: string; device: string; createdAt: number }> {
    return this.sql.exec<{ endpoint: string; device: string; created_at: number }>('SELECT endpoint, device, created_at FROM push_device ORDER BY created_at')
      .toArray().map((row) => ({ endpoint: row.endpoint, device: row.device, createdAt: row.created_at }))
  }

  /**
   * A Robot wants this Member to hear something. Inside the Member's quiet hours it waits
   * for their end (robot-bden); otherwise it goes to every device now.
   */
  async notify(event: { robotId: string; robotName: string; kind: NotificationKind; body: string }): Promise<'sent' | 'deferred'> {
    const notification: PushNotification = {
      title: event.kind === 'finished' ? event.robotName : `${event.robotName} ${event.kind === 'needs you' ? 'needs you' : 'is blocked'}`,
      body: event.body.slice(0, 400),
      url: `/#/r/${encodeURIComponent(event.robotId)}`,
      tag: `${event.robotId}-${event.kind}`,
      urgency: event.kind === 'finished' ? 'normal' : 'high',
    }
    const until = this.quietUntil(Date.now())
    if (until !== null) {
      this.sql.exec('INSERT INTO pending_notification (deliver_at, notification) VALUES (?, ?)', until, JSON.stringify(notification))
      const alarm = await this.ctx.storage.getAlarm()
      if (alarm === null || alarm > until) await this.ctx.storage.setAlarm(until)
      return 'deferred'
    }
    await this.deliver(notification)
    return 'sent'
  }

  override async alarm(): Promise<void> {
    const now = Date.now()
    const due = this.sql.exec<{ id: number; notification: string }>('SELECT id, notification FROM pending_notification WHERE deliver_at <= ? ORDER BY id', now).toArray()
    for (const row of due) {
      this.sql.exec('DELETE FROM pending_notification WHERE id = ?', row.id)
      await this.deliver(JSON.parse(row.notification) as PushNotification)
    }
    const next = this.sql.exec<{ at: number | null }>('SELECT MIN(deliver_at) AS at FROM pending_notification').one().at
    if (next !== null) await this.ctx.storage.setAlarm(next)
  }

  /** When the current quiet window ends, or null when now is outside it. */
  private quietUntil(now: number): number | null {
    const profile = this.profile()
    const quiet = profile.quietHours
    if (quiet === null) return null
    const [startHour, startMinute] = quiet.start.split(':').map(Number) as [number, number]
    const [endHour, endMinute] = quiet.end.split(':').map(Number) as [number, number]
    const local = localDate(now, profile.timeZone)
    const minutes = local.hour * 60 + local.minute
    const start = startHour * 60 + startMinute
    const end = endHour * 60 + endMinute
    const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
    if (!inside) return null
    const endToday = zonedTime(local, endHour, endMinute, profile.timeZone)
    return endToday > now ? endToday : endToday + 86_400_000
  }

  protected async deliver(notification: PushNotification): Promise<void> {
    const vapid = { privateKeyHex: this.env.VAPID_PRIVATE_KEY, publicKey: this.env.VAPID_PUBLIC_KEY, subject: `mailto:${this.profile().email}` }
    const devices = this.sql.exec<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_device').toArray()
    await Promise.all(devices.map((device) => Effect.runPromise(
      sendPush(vapid, { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, notification).pipe(
        Effect.catchTag('PushGone', () => Effect.sync(() => this.removePushDevice(device.endpoint))),
        Effect.catchTag('PushFailed', (error) => Effect.sync(() => console.warn('push failed', error.status))),
      ),
    )))
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