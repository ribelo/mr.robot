/**
 * A Member's Hosts (v1.2 ticket 01): the computers they paired, the one WebSocket each keeps to
 * this Durable Object, heartbeats, and the typed RPC calls robots make on them. Every call names
 * the Robot and the grant it runs under; the grant is checked here before anything reaches the host.
 */
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import type { HostView } from '@mr-robot/protocol'
import { frame, HEARTBEAT_MS, makeHostClient, OFFLINE_AFTER_MS, parseFrame, type Heartbeat, type HostNotification } from '@mr-robot/host-protocol'
import type { Env } from '../env.ts'
import { HOME_ID } from '../env.ts'

export type HostGrant = 'browser' | 'files' | 'shell'

type HostRow = {
  id: string
  name: string
  platform: string
  token_hash: string
  sharing: 'private' | 'home'
  paired_at: number
  last_seen: number | null
  online: number
  heartbeat: string | null
  origin: string | null
}

/** The registry entry the Home keeps for sharing and the admin view. */
export interface HostEntry {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly platform: string
  readonly sharing: 'private' | 'home'
  readonly online: boolean
  readonly lastSeen: number | null
  readonly version: string | null
  readonly capabilities: HostView['capabilities']
  readonly users: readonly string[]
}

export class HostOffline extends Error {
  override readonly name = 'HostOffline'
  readonly status = 409
}

export class HostRefused extends Error {
  override readonly name = 'Invalid'
  readonly status = 403
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type Client = Effect.Success<ReturnType<typeof makeHostClient>['client']>

export class HostHub {
  private readonly clients = new Map<string, { client: Client; deliver: (data: string) => Effect.Effect<void>; scope: Scope.Closeable }>()
  /** Robots using each host's browser now: session → robot name. */
  private readonly users = new Map<string, Map<string, string>>()

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env, private readonly ownerId: () => string) {
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS host (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, token_hash TEXT NOT NULL, sharing TEXT NOT NULL,
      paired_at INTEGER NOT NULL, last_seen INTEGER, online INTEGER NOT NULL DEFAULT 0, heartbeat TEXT, origin TEXT
    )`)
  }

  private row(id: string): HostRow | undefined {
    return this.ctx.storage.sql.exec<HostRow>('SELECT * FROM host WHERE id = ?', id).toArray()[0]
  }

  private entry(row: HostRow): HostEntry {
    const heartbeat = row.heartbeat === null ? null : (JSON.parse(row.heartbeat) as Heartbeat)
    return {
      id: row.id, ownerId: this.ownerId(), name: row.name, platform: heartbeat?.platform ?? row.platform, sharing: row.sharing,
      online: row.online === 1, lastSeen: row.last_seen, version: heartbeat?.version ?? null, capabilities: heartbeat?.capabilities ?? null,
      users: [...new Set(this.users.get(row.id)?.values() ?? [])],
    }
  }

  private async report(id: string): Promise<void> {
    const row = this.row(id)
    await this.env.HOME.getByName(HOME_ID).hostChanged(row === undefined ? { id, removed: true } : this.entry(row)).catch((error: unknown) => console.warn('host report failed', error))
  }

  /** A new host for this Member; the token is returned once and stored only as a hash. */
  async pair(name: string, platform: string): Promise<{ hostId: string; token: string }> {
    const hostId = `h-${crypto.randomUUID()}`
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    this.ctx.storage.sql.exec('INSERT INTO host (id, name, platform, token_hash, sharing, paired_at) VALUES (?, ?, ?, ?, ?, ?)', hostId, name.trim().slice(0, 80) || 'Host', platform, await sha256(token), 'private', Date.now())
    await this.report(hostId)
    return { hostId, token }
  }

  list(): HostEntry[] {
    return this.ctx.storage.sql.exec<HostRow>('SELECT * FROM host ORDER BY paired_at').toArray().map((row) => this.entry(row))
  }

  async setSharing(id: string, sharing: 'private' | 'home'): Promise<void> {
    if (this.row(id) === undefined) throw new HostRefused('no such host')
    this.ctx.storage.sql.exec('UPDATE host SET sharing = ? WHERE id = ?', sharing, id)
    await this.report(id)
  }

  /** Unpair (hs-rwxw): the token stops working and the app is disconnected. */
  async unpair(id: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM host WHERE id = ?', id)
    for (const socket of this.ctx.getWebSockets(`host:${id}`)) {
      try { socket.close(4001, 'unpaired') } catch { /* closing */ }
    }
    await this.drop(id)
    await this.report(id)
  }

  /** The host's own WebSocket (hs-ebba): the token must match the stored hash. */
  async connect(request: Request): Promise<Response> {
    const id = request.headers.get('x-host-id') ?? ''
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const row = this.row(id)
    if (row === undefined || row.token_hash !== (await sha256(token))) return new Response('unknown host or token', { status: 401 })
    for (const old of this.ctx.getWebSockets(`host:${id}`)) {
      try { old.close(4000, 'replaced by a new connection') } catch { /* closing */ }
    }
    await this.drop(id)
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], [`host:${id}`])
    const origin = request.headers.get('x-origin') ?? new URL(request.url).origin
    this.ctx.storage.sql.exec('UPDATE host SET online = 1, last_seen = ?, origin = ? WHERE id = ?', Date.now(), origin, id)
    await this.armSweep()
    await this.report(id)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The app's relay socket for one browser session, or the Robot's end of it. */
  async relay(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const session = url.searchParams.get('session') ?? ''
    const side = url.searchParams.get('side')
    if (side === 'host') {
      const id = request.headers.get('x-host-id') ?? ''
      const row = this.row(id)
      const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      if (row === undefined || row.token_hash !== (await sha256(token)) || !session.startsWith(`${id}:`)) return new Response('refused', { status: 401 })
    } else if (side !== 'robot' || this.ctx.getWebSockets(`relay-host:${session}`).length === 0) {
      return new Response('no such browser session', { status: 404 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1], [`relay-${side}:${session}`])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** Every message on a hibernatable socket of this hub; false when the socket is not a host's. */
  async message(socket: WebSocket, data: string | ArrayBuffer): Promise<boolean> {
    const tag = this.ctx.getTags(socket)[0] ?? ''
    if (tag.startsWith('relay-')) {
      const [side, session] = tag.slice('relay-'.length).split(/:(.*)/s) as [string, string]
      for (const partner of this.ctx.getWebSockets(`relay-${side === 'host' ? 'robot' : 'host'}:${session}`)) {
        try { partner.send(data) } catch { /* closing */ }
      }
      return true
    }
    if (!tag.startsWith('host:')) return false
    const id = tag.slice('host:'.length)
    const parsed = typeof data === 'string' ? parseFrame(data) : undefined
    if (parsed?.t === 'hb') {
      const previous = this.row(id)?.heartbeat
      this.ctx.storage.sql.exec('UPDATE host SET last_seen = ?, online = 1, heartbeat = ? WHERE id = ?', Date.now(), JSON.stringify(parsed.d), id)
      // The registry hears of version or capability changes at once, and of liveness about once a minute.
      const lastReported = Number((await this.ctx.storage.get<number>(`host-reported:${id}`)) ?? 0)
      if (previous !== JSON.stringify(parsed.d) || Date.now() - lastReported > 60_000) {
        await this.ctx.storage.put(`host-reported:${id}`, Date.now())
        await this.report(id)
      }
      await this.armSweep()
    } else if (parsed?.t === 'rpc') {
      const link = this.clients.get(id)
      if (link !== undefined) await Effect.runPromise(link.deliver(parsed.d))
    }
    return true
  }

  async closed(socket: WebSocket): Promise<boolean> {
    const tag = this.ctx.getTags(socket)[0] ?? ''
    if (tag.startsWith('relay-')) {
      const [side, session] = tag.slice('relay-'.length).split(/:(.*)/s) as [string, string]
      for (const partner of this.ctx.getWebSockets(`relay-${side === 'host' ? 'robot' : 'host'}:${session}`)) {
        try { partner.close(1000, 'the other end closed') } catch { /* closing */ }
      }
      this.users.get(session.split(':')[0] ?? '')?.delete(session)
      return true
    }
    if (!tag.startsWith('host:')) return false
    const id = tag.slice('host:'.length)
    if (this.ctx.getWebSockets(tag).filter((other) => other !== socket).length === 0) {
      this.ctx.storage.sql.exec('UPDATE host SET online = 0 WHERE id = ?', id)
      await this.drop(id)
      await this.report(id)
    }
    return true
  }

  /** Hosts whose heartbeats stopped are offline (hs-7dlt); returns when to check next. */
  async sweep(now: number): Promise<number | null> {
    let next: number | null = null
    for (const row of this.ctx.storage.sql.exec<HostRow>('SELECT * FROM host WHERE online = 1').toArray()) {
      const due = (row.last_seen ?? 0) + OFFLINE_AFTER_MS
      if (due <= now) {
        for (const socket of this.ctx.getWebSockets(`host:${row.id}`)) {
          try { socket.close(4002, 'no heartbeat') } catch { /* closing */ }
        }
        this.ctx.storage.sql.exec('UPDATE host SET online = 0 WHERE id = ?', row.id)
        await this.drop(row.id)
        await this.report(row.id)
      } else next = next === null ? due : Math.min(next, due)
    }
    return next
  }

  private async armSweep(): Promise<void> {
    const due = Date.now() + OFFLINE_AFTER_MS + HEARTBEAT_MS
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm === null || alarm > due) await this.ctx.storage.setAlarm(due)
  }

  private async drop(id: string): Promise<void> {
    const link = this.clients.get(id)
    this.clients.delete(id)
    if (link !== undefined) await Effect.runPromise(Scope.close(link.scope, Exit.void))
  }

  /** The RPC client of a connected host, built once per connection (and again after hibernation). */
  private async client(id: string): Promise<Client> {
    const known = this.clients.get(id)
    if (known !== undefined) return known.client
    const socket = this.ctx.getWebSockets(`host:${id}`)[0]
    if (socket === undefined || this.row(id)?.online !== 1) throw new HostOffline(`the host "${this.row(id)?.name ?? id}" is offline`)
    const side = makeHostClient((text) => socket.send(text))
    const scope = await Effect.runPromise(Scope.make())
    const client = await Effect.runPromise(Scope.provide(side.client, scope))
    this.clients.set(id, { client, deliver: side.deliver, scope })
    return client
  }

  /**
   * A Robot's call on one of this Member's hosts (hs-5ktw): the Robot must hold the grant for that
   * host and kind, or be its owner's Mr. Robot; a shared host serves every Home member's robots.
   */
  async authorize(id: string, robotId: string, grant: HostGrant): Promise<HostRow> {
    const row = this.row(id)
    if (row === undefined) throw new HostRefused('no such host')
    const robot = await this.env.ROBOT.getByName(robotId).hostAccess(id, grant)
    const reaches = robot.ownerId === this.ownerId() || row.sharing === 'home'
    if (!reaches || !(robot.granted || robot.mrRobot)) throw new HostRefused(`${robot.name} has no ${grant} grant on the host "${row.name}". Ask your owner with propose_grants.`)
    if (row.online !== 1) throw new HostOffline(`the host "${row.name}" is offline (last seen ${row.last_seen === null ? 'never' : new Date(row.last_seen).toISOString().slice(0, 16).replace('T', ' ')} UTC)`)
    return row
  }

  async run<A>(id: string, robotId: string, grant: HostGrant, call: (client: Client) => Effect.Effect<A, unknown>, timeoutMs = 120_000): Promise<A> {
    await this.authorize(id, robotId, grant)
    const client = await this.client(id)
    const exit = await Effect.runPromiseExit(call(client).pipe(Effect.timeout(timeoutMs)))
    if (Exit.isSuccess(exit)) return exit.value
    const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail') as { error?: { _tag?: string; message?: string; code?: string } } | undefined
    const error = failure?.error
    if (error?._tag === 'HostError') throw new Error(`${error.message}${error.code === undefined ? '' : ` (${error.code})`}`)
    if (error?._tag === 'TimeoutError') throw new Error(`the host did not answer within ${Math.round(timeoutMs / 1000)} s`)
    if (this.row(id)?.online !== 1) throw new HostOffline(`the host "${this.row(id)?.name ?? id}" went offline`)
    throw new Error(`the host call failed: ${String(error?.message ?? exit.cause)}`)
  }

  /** Open a browser session on a host: the app connects its relay socket, then the Robot gets its end. */
  async openBrowser(id: string, robotId: string, robotName: string): Promise<string> {
    const row = await this.authorize(id, robotId, 'browser')
    const session = `${id}:${crypto.randomUUID()}`
    const relayUrl = `${row.origin ?? ''}/api/host/relay?session=${encodeURIComponent(session)}`
    await this.run(id, robotId, 'browser', (client) => client.BrowserOpen({ session, relayUrl }), 60_000)
    const users = this.users.get(id) ?? new Map<string, string>()
    users.set(session, robotName)
    this.users.set(id, users)
    await this.report(id)
    return session
  }

  async closeBrowser(id: string, robotId: string, session: string): Promise<void> {
    this.users.get(id)?.delete(session)
    for (const socket of [...this.ctx.getWebSockets(`relay-robot:${session}`), ...this.ctx.getWebSockets(`relay-host:${session}`)]) {
      try { socket.close(1000, 'closed') } catch { /* closing */ }
    }
    await this.run(id, robotId, 'browser', (client) => client.BrowserClose({ session }), 15_000).catch(() => undefined)
    await this.report(id)
  }  /** Show a notification on every online computer of this Member (pl-b5vp). */
  notify(notification: HostNotification): number {
    const text = frame({ t: 'notify', d: notification })
    let sent = 0
    for (const host of this.list()) {
      if (!host.online) continue
      for (const socket of this.ctx.getWebSockets(`host:${host.id}`)) {
        try { socket.send(text); sent++ } catch { /* closing */ }
      }
    }
    return sent
  }


}
