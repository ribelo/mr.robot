/**
 * A Member's Hosts (v1.2 ticket 01): the computers they paired, the one WebSocket each keeps to
 * this Durable Object, heartbeats, and the typed RPC calls robots make on them. Every call names
 * the Robot and the grant it runs under; the grant is checked here before anything reaches the host.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import type { HostView } from '@mr-robot/protocol'
import { frame, HEARTBEAT_MS, makeHostClient, OFFLINE_AFTER_MS, parseFrame, parseHeartbeat, SANDBOX_DENIED, SANDBOX_UNAVAILABLE, type HostAccess, type HostNotification, type JobEnded, type JobInfo, type ReceivedHeartbeat, type RunOutcome, type Sandbox } from '@mr-robot/host-protocol'
import type { Env } from '../env.ts'
import { HOME_ID } from '../env.ts'
import type { Reach } from '../places/host-facet.ts'

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

/** What a Robot is told when a command would run confined on a computer that cannot confine it (ob-n72n). */
export const NO_SANDBOX = (host: string, mode: string): string =>
  `${host} has no usable sandbox, so a command in ${mode} mode does not run there (it fails closed). Your owner can install bubblewrap on that computer (Linux) or give you the shell grant in full mode; or call run with escalate for one call.`

/**
 * How long a Host may stay away before its running jobs count as lost (v1.16 ticket 03, ob-cgn1). The jobs live in the app's memory, so a
 * connection that drops and returns with the same app instance loses nothing; a new instance is a restart and loses them at once (the
 * heartbeat says which). A Host that does not come back at all would leave the Robot waiting for ever, so this is the end of the wait.
 */
export const JOBS_LOST_AFTER_MS = 5 * 60_000

/** The name of a job on a Host: the Robot's id and the Robot's name for the job. Only the Robot's id is needed to find its jobs. */
export const jobRef = (robotId: string, jobId: string): string => `${robotId}:${jobId}`
const splitRef = (ref: string): { robotId: string; jobId: string } | undefined => {
  const at = ref.lastIndexOf(':')
  return at <= 0 ? undefined : { robotId: ref.slice(0, at), jobId: ref.slice(at + 1) }
}

type JobRow = { host_id: string; robot_id: string; job_id: string; instance: string }

export class HostOffline extends Data.TaggedError('HostOffline')<{ readonly message: string }> {
  readonly status = 409
}

/** The Robot may not use this Host any more: it is not among the Hosts its owner reaches (unpaired, no longer shared) or its grant is gone. */
export class HostAccessLost extends Data.TaggedError('HostAccessLost')<{ readonly message: string }> {}

/** The Host's app refused a change: the mode or the roots of the grant do not allow it. */
export class HostWriteDenied extends Data.TaggedError('HostWriteDenied')<{ readonly message: string }> {}

/** The Host cannot confine a confined call: no usable sandbox, or an app too old to enforce the grant. The call is refused before it is sent, or by the app. */
export class HostNoSandbox extends Data.TaggedError('HostNoSandbox')<{ readonly message: string }> {}

export class HostRefused extends Error {
  override readonly name = 'Invalid'
  readonly status = 403
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type Client = Effect.Success<ReturnType<typeof makeHostClient>['client']>

export interface HostAction {
  readonly robotId: string
  readonly robotName: string
  readonly action: string
  readonly detail: string
  /** "done", or the error. */
  readonly outcome: string
  readonly exitCode: number | null
  readonly at: number
}

export class HostHub {
  private readonly clients = new Map<string, { client: Client; deliver: (data: string) => Effect.Effect<void>; scope: Scope.Closeable }>()
  /** Robots using each host's browser now: session → robot name. */
  private readonly users = new Map<string, Map<string, string>>()

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env, private readonly ownerId: () => string) {
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS host (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, token_hash TEXT NOT NULL, sharing TEXT NOT NULL,
      paired_at INTEGER NOT NULL, last_seen INTEGER, online INTEGER NOT NULL DEFAULT 0, heartbeat TEXT, origin TEXT
    )`)
    // The jobs Robots have on each Host, and the run of the app each started under: which Robot to tell when they are lost.
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS host_job (
      host_id TEXT NOT NULL, robot_id TEXT NOT NULL, job_id TEXT NOT NULL, instance TEXT NOT NULL, started_at INTEGER NOT NULL,
      PRIMARY KEY (host_id, robot_id, job_id)
    )`)
  }

  private row(id: string): HostRow | undefined {
    return this.ctx.storage.sql.exec<HostRow>('SELECT * FROM host WHERE id = ?', id).toArray()[0]
  }

  private entry(row: HostRow): HostEntry {
    const heartbeat = this.heartbeatOf(row)
    return {
      id: row.id, ownerId: this.ownerId(), name: row.name, platform: heartbeat?.platform ?? row.platform, sharing: row.sharing,
      online: row.online === 1, lastSeen: row.last_seen, version: heartbeat?.version ?? null,
      capabilities: heartbeat === undefined ? null : { graphical: heartbeat.capabilities.graphical, chrome: heartbeat.capabilities.chrome, ...(heartbeat.capabilities.sandbox === undefined ? {} : { sandbox: heartbeat.capabilities.sandbox }), ...(heartbeat.capabilities.shell === undefined ? {} : { shell: heartbeat.capabilities.shell }) },
      users: [...new Set(this.users.get(row.id)?.values() ?? [])],
    }
  }

  /** The last heartbeat of a Host, decoded; undefined when it has none or is not one. */
  private heartbeatOf(row: HostRow | undefined): ReceivedHeartbeat | undefined {
    return row?.heartbeat == null ? undefined : parseHeartbeat(row.heartbeat)
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
    await this.loseJobs(id, (name) => `${name} was unpaired while it ran`)
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
      // Another run of the app than the jobs started under: it restarted, and its jobs went with it.
      if (typeof parsed.d.instance === 'string') await this.loseJobs(id, (name) => `the Mr. Robot app on ${name} was restarted while it ran`, parsed.d.instance)
    } else if (parsed?.t === 'job') {
      await this.jobEnded(id, parsed.d)
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
      await this.armJobsLost(id)
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
    // A Host that stayed away with jobs running: past the wait they are lost.
    for (const row of this.ctx.storage.sql.exec<HostRow>('SELECT * FROM host WHERE online = 0 AND id IN (SELECT host_id FROM host_job)').toArray()) {
      const due = (row.last_seen ?? 0) + JOBS_LOST_AFTER_MS
      if (due <= now) await this.loseJobs(row.id, (name) => `${name} stayed offline for more than ${JOBS_LOST_AFTER_MS / 60_000} minutes while it ran`)
      else next = next === null ? due : Math.min(next, due)
    }
    return next
  }

  /** The alarm comes back when the jobs of a Host that went offline are due to be lost. */
  private async armJobsLost(id: string): Promise<void> {
    if (this.ctx.storage.sql.exec('SELECT 1 FROM host_job WHERE host_id = ? LIMIT 1', id).toArray().length === 0) return
    const due = (this.row(id)?.last_seen ?? Date.now()) + JOBS_LOST_AFTER_MS
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm === null || alarm > due) await this.ctx.storage.setAlarm(due)
  }

  /** A Robot started a job on a Host (the app answered promoted or background): remember which Robot to tell if it is lost. */
  trackJob(hostId: string, robotId: string, jobId: string): void {
    const instance = this.instanceOf(this.row(hostId))
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO host_job (host_id, robot_id, job_id, instance, started_at) VALUES (?, ?, ?, ?, ?)', hostId, robotId, jobId, instance, Date.now())
  }

  private forgetJob(hostId: string, robotId: string, jobId: string): void {
    this.ctx.storage.sql.exec('DELETE FROM host_job WHERE host_id = ? AND robot_id = ? AND job_id = ?', hostId, robotId, jobId)
  }

  private instanceOf(row: HostRow | undefined): string {
    return this.heartbeatOf(row)?.instance ?? ''
  }

  /**
   * Jobs of a Host are lost: each Robot that owns one is told, once, and the Robot wakes as failed. With `instance` only the jobs that
   * started under another run of the app are lost (a heartbeat of a restarted app); a job whose run is not known is never lost by that.
   */
  private async loseJobs(hostId: string, reasonFor: (hostName: string) => string, instance?: string): Promise<void> {
    const rows = this.ctx.storage.sql.exec<JobRow>(
      instance === undefined ? 'SELECT * FROM host_job WHERE host_id = ?' : "SELECT * FROM host_job WHERE host_id = ? AND instance != '' AND instance != ?",
      ...(instance === undefined ? [hostId] : [hostId, instance]),
    ).toArray()
    if (rows.length === 0) return
    for (const row of rows) this.forgetJob(row.host_id, row.robot_id, row.job_id)
    const reason = reasonFor(this.row(hostId)?.name ?? 'The Host')
    for (const robotId of new Set(rows.map((row) => row.robot_id))) {
      const ids = rows.filter((row) => row.robot_id === robotId).map((row) => row.job_id)
      await this.env.ROBOT.getByName(robotId).hostJobsLost(ids, reason).catch((error: unknown) => console.warn('lost jobs not told', error))
    }
  }

  /**
   * The app on `hostId` says a job ended with nobody waiting for it: the Robot that owns it closes it and wakes. Only a job this Host
   * was asked to run counts; a frame naming any other job (another Host's, a Box job, a Robot that never ran here) is dropped. A frame
   * that comes before the job was remembered is dropped too, and the Robot's alarm finds the ended job by asking the app.
   */
  private async jobEnded(hostId: string, ended: JobEnded): Promise<void> {
    const ref = splitRef(ended.job)
    if (ref === undefined) return
    const tracked = this.ctx.storage.sql.exec('SELECT 1 FROM host_job WHERE host_id = ? AND robot_id = ? AND job_id = ?', hostId, ref.robotId, ref.jobId).toArray().length > 0
    if (!tracked) return
    this.forgetJob(hostId, ref.robotId, ref.jobId)
    await this.env.ROBOT.getByName(ref.robotId).hostJobEnded(hostId, ref.jobId, { state: ended.state, exitCode: ended.exitCode, signal: ended.signal }).catch((error: unknown) => console.warn('ended job not told', error))
  }

  /** The jobs of one Robot that the app holds, named as the Robot named them. */
  async jobList(id: string, robotId: string): Promise<JobInfo[]> {
    const { jobs } = await this.run(id, robotId, 'shell', (client) => client.JobList({ robot: robotId }), 30_000)
    for (const job of jobs) {
      const ref = splitRef(job.job)
      if (ref !== undefined && job.state !== 'running') this.forgetJob(id, ref.robotId, ref.jobId)
    }
    return jobs.flatMap((job) => { const ref = splitRef(job.job); return ref === undefined ? [] : [{ ...job, job: ref.jobId }] })
  }

  jobOutput(id: string, robotId: string, jobId: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    return this.run(id, robotId, 'shell', (client) => client.JobOutput({ job: jobRef(robotId, jobId), stream, offset }), 60_000)
  }

  async jobKill(id: string, robotId: string, jobId: string): Promise<void> {
    await this.run(id, robotId, 'shell', (client) => client.JobKill({ job: jobRef(robotId, jobId) }), 30_000, { action: 'stop job', detail: jobId })
    this.forgetJob(id, robotId, jobId)
  }

  /** What a Run answered: a job that goes on is remembered. */
  jobStarted(hostId: string, robotId: string, jobId: string, outcome: RunOutcome): RunOutcome {
    if (outcome.kind !== 'foreground') this.trackJob(hostId, robotId, jobId)
    return outcome
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
    if (socket === undefined || this.row(id)?.online !== 1) throw new HostOffline({ message: `the host "${this.row(id)?.name ?? id}" is offline` })
    const side = makeHostClient((text) => socket.send(text))
    const scope = await Effect.runPromise(Scope.make())
    const client = await Effect.runPromise(Scope.provide(side.client, scope))
    this.clients.set(id, { client, deliver: side.deliver, scope })
    return client
  }

  /**
   * A Robot's call on one of this Member's hosts (hs-5ktw): the Robot must hold the grant for that
   * host and kind (Mr. Robot holds it unless his owner lowered it, sk-br7y); a shared host serves every Home member's robots.
   */
  async authorize(id: string, robotId: string, grant: HostGrant): Promise<{ row: HostRow; access: HostAccess }> {
    const row = this.row(id)
    if (row === undefined) throw new HostAccessLost({ message: 'no such host' })
    const robot = await this.env.ROBOT.getByName(robotId).hostAccess(id, grant)
    this.robotNames.set(robotId, robot.name)
    const reaches = robot.ownerId === this.ownerId() || row.sharing === 'home'
    if (!reaches || !robot.granted) throw new HostAccessLost({ message: `${robot.name} has no ${grant} grant on the host "${row.name}". Ask your owner with propose_grants.` })
    if (row.online !== 1) throw new HostOffline({ message: `the host "${row.name}" is offline (last seen ${row.last_seen === null ? 'never' : new Date(row.last_seen).toISOString().slice(0, 16).replace('T', ' ')} UTC)` })
    return { row, access: robot.access }
  }

  /** Which robot did what on a host, when, and how it ended (pl-vcy7). */
  private record(entry: { hostId: string; robotId: string; action: string; detail: string; outcome: string; exitCode: number | null }): void {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS host_action (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id TEXT NOT NULL, robot_id TEXT NOT NULL, robot_name TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, outcome TEXT NOT NULL, exit_code INTEGER, at INTEGER NOT NULL)')
    this.ctx.storage.sql.exec('INSERT INTO host_action (host_id, robot_id, robot_name, action, detail, outcome, exit_code, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entry.hostId, entry.robotId, this.robotNames.get(entry.robotId) ?? entry.robotId, entry.action, entry.detail.slice(0, 500), entry.outcome.slice(0, 300), entry.exitCode, Date.now())
    this.ctx.storage.sql.exec('DELETE FROM host_action WHERE host_id = ? AND id NOT IN (SELECT id FROM host_action WHERE host_id = ? ORDER BY id DESC LIMIT 500)', entry.hostId, entry.hostId)
  }

  private readonly robotNames = new Map<string, string>()

  /** A copy is one line in the host's log, not one per piece (v1.15, copy). */
  recordCopy(entry: { hostId: string; robotId: string; detail: string; outcome: string }): void {
    this.record({ ...entry, action: 'copy', exitCode: null })
  }

  /** The latest actions on one host, newest first. */
  actions(id: string, limit = 100): HostAction[] {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS host_action (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id TEXT NOT NULL, robot_id TEXT NOT NULL, robot_name TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, outcome TEXT NOT NULL, exit_code INTEGER, at INTEGER NOT NULL)')
    return this.ctx.storage.sql.exec<{ robot_id: string; robot_name: string; action: string; detail: string; outcome: string; exit_code: number | null; at: number }>('SELECT * FROM host_action WHERE host_id = ? ORDER BY id DESC LIMIT ?', id, limit).toArray()
      .map((row) => ({ robotId: row.robot_id, robotName: row.robot_name, action: row.action, detail: row.detail, outcome: row.outcome, exitCode: row.exit_code, at: row.at }))
  }

  async run<A>(id: string, robotId: string, grant: HostGrant, call: (client: Client, access: HostAccess) => Effect.Effect<A, unknown>, timeoutMs = 120_000, log?: { action: string; detail: string; exitCode?: (value: A) => number | null }, reach: Reach = 'granted'): Promise<A> {
    try {
      const value = await this.runUnlogged(id, robotId, grant, call, timeoutMs, reach)
      if (log !== undefined) this.record({ hostId: id, robotId, action: log.action, detail: log.detail, outcome: 'done', exitCode: log.exitCode?.(value) ?? null })
      return value
    } catch (error) {
      if (log !== undefined) this.record({ hostId: id, robotId, action: log.action, detail: log.detail, outcome: error instanceof Error ? error.message : String(error), exitCode: null })
      throw error
    }
  }

  private async runUnlogged<A>(id: string, robotId: string, grant: HostGrant, call: (client: Client, access: HostAccess) => Effect.Effect<A, unknown>, timeoutMs: number, reach: Reach): Promise<A> {
    const { row, access: granted } = await this.authorize(id, robotId, grant)
    // An escalated call is one the owner approved to run without the sandbox, once (ob-ifak); it never changes the grant.
    const access: HostAccess = reach === 'escalated' ? { ...granted, mode: 'full' } : granted
    if (grant !== 'browser' && access.mode !== 'full') {
      const sandbox = this.sandboxOf(row)
      // An app from before v1.16 ignores the access of a call, so a confined call to it would run unconfined: it is refused, not sent.
      if (sandbox === undefined) throw new HostNoSandbox({ message: `${row.name} runs a Mr. Robot app too old to enforce the mode of this grant, so a ${access.mode} call is not sent: update the Mr. Robot app on ${row.name}, or give the grant full access.` })
      // A confined command on a computer that cannot confine fails closed here too; the app refuses it as well (ob-n72n).
      if (grant === 'shell' && sandbox === 'none') throw new HostNoSandbox({ message: NO_SANDBOX(row.name, access.mode) })
    }
    const client = await this.client(id)
    const exit = await Effect.runPromiseExit(call(client, access).pipe(Effect.timeout(timeoutMs)))
    if (Exit.isSuccess(exit)) return exit.value
    const failure = exit.cause.reasons.find((reason) => reason._tag === 'Fail') as { error?: { _tag?: string; message?: string; code?: string } } | undefined
    const error = failure?.error
    if (error?._tag === 'HostError') {
      const said = `${error.message}${error.code === undefined ? '' : ` (${error.code})`}`
      if (error.code === SANDBOX_DENIED) throw new HostWriteDenied({ message: error.message ?? said })
      if (error.code === SANDBOX_UNAVAILABLE) throw new HostNoSandbox({ message: error.message ?? said })
      throw new Error(said)
    }
    if (error?._tag === 'TimeoutError') throw new Error(`the host did not answer within ${Math.round(timeoutMs / 1000)} s`)
    if (this.row(id)?.online !== 1) throw new HostOffline({ message: `the host "${this.row(id)?.name ?? id}" went offline` })
    throw new Error(`the host call failed: ${String(error?.message ?? exit.cause)}`)
  }

  /** What the last heartbeat said about the sandbox; undefined for an app from before v1.16, which does not say. */
  private sandboxOf(row: HostRow): Sandbox | undefined {
    return this.heartbeatOf(row)?.capabilities.sandbox
  }

  /** Open a browser session on a host: the app connects its relay socket, then the Robot gets its end. */
  async openBrowser(id: string, robotId: string, robotName: string): Promise<string> {
    const { row } = await this.authorize(id, robotId, 'browser')
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
  }

  /**
   * Show a notification on the computers of this Member (pl-b5vp). A tool-call Ask names the Host of the facet it uses, and that Host
   * shows it alone (ob-6jr5); when no named Host is online, every online computer shows it, as before.
   */
  notify(notification: HostNotification, named: readonly string[] = []): number {
    const online = this.list().filter((host) => host.online)
    const targeted = online.filter((host) => named.includes(host.id))
    const text = frame({ t: 'notify', d: notification })
    let sent = 0
    for (const host of targeted.length > 0 ? targeted : online) {
      for (const socket of this.ctx.getWebSockets(`host:${host.id}`)) {
        try { socket.send(text); sent++ } catch { /* closing */ }
      }
    }
    return sent
  }


}
