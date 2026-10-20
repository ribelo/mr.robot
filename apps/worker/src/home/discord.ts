/**
 * Discord at the Home (v1.5 ticket 05): which Robot talks in which channel (cn-y1ac), posting through
 * the Home's bot connection (cn-65gg), and the gateway socket that brings messages in. The gateway
 * protocol and the reconnect rules are pure, in ../connectors/discord-gateway.ts.
 *
 * One socket at a time: a socket this object dropped can no longer change its state, a connect
 * already under way is shared, and every connect is recorded so restarts cannot loop (Discord resets
 * the bot's token after about 1000 connections in a short time).
 */
import * as Effect from 'effect/Effect'
import { discordPostMessage, type DiscordFile } from '../connectors/discord.ts'
import { closeVerdict, GATEWAY_URL, gatewayStep, heartbeat, initialGateway, nextConnectAt, readPayload, resumeAddress, type GatewayMessage, type GatewayState } from '../connectors/discord-gateway.ts'

export interface BotConnection {
  readonly ownerId: string
  readonly connectionId: string
  readonly token: string
}

export class DiscordAtHome {
  /** The socket that is live now; events from any other socket are ignored. */
  private live: LiveSocket | undefined
  private connecting: Promise<void> | undefined
  private state: GatewayState = initialGateway
  /** The next socket resumes the session instead of identifying (Discord asked, or the socket dropped). */
  private resume = false
  private heartbeatDue = 0

  constructor(
    private readonly sql: SqlStorage,
    /** The bot token of a Member's Discord connection (own or shared), or null. */
    private readonly bot: (memberId: string | null) => Promise<BotConnection | null>,
    private readonly fetch: typeof globalThis.fetch,
    /** A message arrived on Discord: hand it to the Robot that owns the channel. */
    private readonly inbound: (message: GatewayMessage, ownerId: string) => Promise<void>,
    /** Ask the Durable Object for its alarm, to drive heartbeats and reconnects. */
    private readonly setAlarm: (at: number) => Promise<void>,
    /** Every bot the gateway may use, default connections first; defaults to the one bot(null) gives. */
    private readonly bots: () => Promise<readonly BotConnection[]> = async () => { const one = await bot(null); return one === null ? [] : [one] },
  ) {
    sql.exec('CREATE TABLE IF NOT EXISTS discord_channel (channel_id TEXT PRIMARY KEY, robot_id TEXT NOT NULL, owner_id TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS discord_connect (at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS discord_stopped (token_hash TEXT PRIMARY KEY, code INTEGER NOT NULL, at INTEGER NOT NULL)')
  }

  /** A Robot's channel changed: the mapping follows the setting. */
  mapping(robotId: string, ownerId: string, channelId: string | null): void {
    this.sql.exec('DELETE FROM discord_channel WHERE robot_id = ?', robotId)
    if (channelId !== null && channelId !== '') this.sql.exec('INSERT INTO discord_channel (channel_id, robot_id, owner_id) VALUES (?, ?, ?) ON CONFLICT (channel_id) DO UPDATE SET robot_id = excluded.robot_id, owner_id = excluded.owner_id', channelId, robotId, ownerId)
  }

  robotOf(channelId: string): { robotId: string; ownerId: string } | null {
    const row = this.sql.exec<{ robot_id: string; owner_id: string }>('SELECT robot_id, owner_id FROM discord_channel WHERE channel_id = ?', channelId).toArray()[0]
    return row === undefined ? null : { robotId: row.robot_id, ownerId: row.owner_id }
  }

  /** Post text with the Home's bot (the Channel side). */
  async post(memberId: string, channelId: string, text: string, replyTo?: string, files: readonly DiscordFile[] = []): Promise<boolean> {
    const bot = await this.bot(memberId)
    if (bot === null) return false
    const outcome = await Effect.runPromise(Effect.result(discordPostMessage(this.fetch, bot.token, channelId, text, replyTo, files)))
    if (outcome._tag === 'Failure') {
      console.warn('discord post failed', outcome.failure._tag, outcome.failure.message)
      return false
    }
    return outcome.success
  }

  /** Discord's gateway is a WebSocket; one socket per Home, kept alive with heartbeats. */
  async ensure(): Promise<void> {
    const live = this.live
    if (live !== undefined) {
      if (this.heartbeatDue !== 0 && Date.now() >= this.heartbeatDue) {
        try {
          live.socket.send(heartbeat(this.state))
        } catch {
          await this.drop(live, 'resume')
          return
        }
        this.heartbeatDue = Date.now() + this.state.heartbeatMs
      }
      // Another alarm may have replaced the heartbeat's: ask for it again every time.
      await this.setAlarm(this.heartbeatDue)
      return
    }
    this.connecting ??= this.connect().finally(() => { this.connecting = undefined })
    await this.connecting
  }

  private async connect(): Promise<void> {
    // The first bot whose token has not been refused for good (an old connection may still hold a reset token).
    let chosen: { bot: BotConnection; tokenHash: string } | undefined
    for (const candidate of await this.bots()) {
      const hash = await hashOf(candidate.token)
      if (this.sql.exec('SELECT 1 FROM discord_stopped WHERE token_hash = ?', hash).toArray().length === 0) {
        chosen = { bot: candidate, tokenHash: hash }
        break
      }
    }
    if (chosen === undefined) return
    const { bot, tokenHash } = chosen
    const now = Date.now()
    this.sql.exec('DELETE FROM discord_connect WHERE at < ?', now - 2 * 24 * 60 * 60 * 1000)
    const at = nextConnectAt(this.sql.exec<{ at: number }>('SELECT at FROM discord_connect').toArray().map((row) => row.at), now)
    if (at > now) {
      await this.setAlarm(at)
      return
    }
    this.sql.exec('INSERT INTO discord_connect (at) VALUES (?)', now)
    const resuming = this.resume && this.state.sessionId !== null && this.state.resumeUrl !== null
    if (!resuming) this.state = initialGateway
    this.resume = false
    try {
      const response = await this.fetch(resuming ? resumeAddress(this.state.resumeUrl!) : GATEWAY_URL, { headers: { Upgrade: 'websocket' } })
      const socket = response.webSocket
      if (socket === null || socket === undefined) {
        console.warn('discord gateway refused the upgrade', response.status)
        await this.setAlarm(Date.now() + 1_000)
        return
      }
      socket.accept()
      const live: LiveSocket = { socket, token: bot.token, tokenHash, ownerId: bot.ownerId }
      this.live = live
      socket.addEventListener('message', (event: MessageEvent) => { void this.frame(live, String(event.data)) })
      socket.addEventListener('close', (event: CloseEvent) => { void this.closed(live, event.code) })
      this.heartbeatDue = Date.now() + this.state.heartbeatMs
      await this.setAlarm(this.heartbeatDue)
    } catch (error) {
      console.warn('discord gateway connect failed', error)
      await this.setAlarm(Date.now() + 1_000)
    }
  }

  private async frame(live: LiveSocket, text: string): Promise<void> {
    const payload = readPayload(text)
    if (live !== this.live || payload === null) return
    const step = gatewayStep(this.state, payload, live.token)
    this.state = step.state
    for (const frame of step.send) {
      try {
        live.socket.send(frame)
      } catch {
        await this.drop(live, 'resume')
        return
      }
    }
    // HELLO sets the heartbeat interval: the first heartbeat is due one interval from now.
    if (payload.op === 10) {
      this.heartbeatDue = Date.now() + step.state.heartbeatMs
      await this.setAlarm(this.heartbeatDue)
    }
    for (const message of step.messages) await this.inbound(message, live.ownerId).catch((error: unknown) => console.warn('discord inbound failed', error))
    if (step.reconnect) await this.drop(live, 'resume')
  }

  /** This object ends a socket: close it for real, so it cannot linger as a second session. */
  private async drop(live: LiveSocket, next: 'resume' | 'identify'): Promise<void> {
    if (live !== this.live) return
    this.live = undefined
    this.resume = next === 'resume'
    // 4000 keeps the session resumable; Discord ends the session on 1000.
    try { live.socket.close(next === 'resume' ? 4000 : 1000, 'reconnect') } catch { /* already closed */ }
    await this.setAlarm(Date.now() + 1_000)
  }

  private async closed(live: LiveSocket, code: number): Promise<void> {
    // A socket this object already dropped (or replaced) closing late changes nothing.
    if (live !== this.live) return
    this.live = undefined
    const verdict = closeVerdict(code)
    console.warn('discord gateway closed', code, verdict)
    if (verdict === 'fatal') {
      // The same token can never connect: stop until the Discord connection gets a new token.
      this.sql.exec('INSERT INTO discord_stopped (token_hash, code, at) VALUES (?, ?, ?) ON CONFLICT (token_hash) DO UPDATE SET code = excluded.code, at = excluded.at', live.tokenHash, code, Date.now())
      // Another bot may still work; connect() skips the refused token and does nothing when none is left.
      await this.setAlarm(Date.now() + 1_000)
      return
    }
    this.resume = verdict === 'resume'
    // The alarm wakes the Durable Object, which connects again within the limits of connect().
    await this.setAlarm(Date.now() + 1_000)
  }
}

interface LiveSocket {
  readonly socket: WebSocket
  readonly token: string
  readonly tokenHash: string
  readonly ownerId: string
}

async function hashOf(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
