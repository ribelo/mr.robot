/**
 * Discord at the Home (v1.5 ticket 05): which Robot talks in which channel (cn-y1ac), posting through
 * the Home's bot connection (cn-65gg), and the gateway socket that brings messages in. The gateway
 * protocol itself is pure, in ../connectors/discord-gateway.ts.
 */
import * as Effect from 'effect/Effect'
import { discordPostMessage } from '../connectors/discord.ts'
import { GATEWAY_URL, gatewayStep, heartbeat, initialGateway, readPayload, type GatewayMessage, type GatewayState } from '../connectors/discord-gateway.ts'

export interface BotConnection {
  readonly ownerId: string
  readonly connectionId: string
  readonly token: string
}

export class DiscordAtHome {
  private socket: { readonly socket: WebSocket; readonly token: string; readonly ownerId: string } | undefined
  private state: GatewayState = initialGateway
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
  ) {
    sql.exec('CREATE TABLE IF NOT EXISTS discord_channel (channel_id TEXT PRIMARY KEY, robot_id TEXT NOT NULL, owner_id TEXT NOT NULL)')
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
  async post(memberId: string, channelId: string, text: string): Promise<boolean> {
    const bot = await this.bot(memberId)
    if (bot === null) return false
    const outcome = await Effect.runPromise(Effect.result(discordPostMessage(this.fetch, bot.token, channelId, text)))
    if (outcome._tag === 'Failure') {
      console.warn('discord post failed', outcome.failure._tag, outcome.failure.message)
      return false
    }
    return outcome.success
  }

  /** Discord's gateway is a WebSocket; one socket per Home, kept alive with heartbeats. */
  async ensure(): Promise<void> {
    if (this.socket !== undefined) {
      // A heartbeat is due: send it and come back later.
      if (this.heartbeatDue !== 0 && Date.now() >= this.heartbeatDue) {
        try { this.socket.socket.send(heartbeat(this.state)) } catch { this.socket = undefined }
        this.heartbeatDue = Date.now() + this.state.heartbeatMs
        await this.setAlarm(this.heartbeatDue)
      }
      return
    }
    const bot = await this.bot(null)
    if (bot === null) return
    try {
      const response = await this.fetch(GATEWAY_URL, { headers: { Upgrade: 'websocket' } })
      const socket = response.webSocket
      if (socket === null || socket === undefined) return
      socket.accept()
      this.state = initialGateway
      this.socket = { socket, token: bot.token, ownerId: bot.ownerId }
      socket.addEventListener('message', (event: MessageEvent) => { void this.frame(String(event.data)) })
      socket.addEventListener('close', (event: CloseEvent) => { void this.closed(event.code) })
      this.heartbeatDue = Date.now() + this.state.heartbeatMs
      await this.setAlarm(this.heartbeatDue)
    } catch (error) {
      console.warn('discord gateway connect failed', error)
      await this.setAlarm(Date.now() + 30_000)
    }
  }

  private async frame(text: string): Promise<void> {
    const socket = this.socket
    const payload = readPayload(text)
    if (socket === undefined || payload === null) return
    const step = gatewayStep(this.state, payload, socket.token)
    this.state = step.state
    for (const frame of step.send) {
      try { socket.socket.send(frame) } catch { this.socket = undefined }
    }
    // HELLO sets the heartbeat interval: the first heartbeat is due one interval from now.
    if (payload.op === 10) {
      this.heartbeatDue = Date.now() + step.state.heartbeatMs
      await this.setAlarm(this.heartbeatDue)
    }
    if (step.reconnect) await this.closed(1000)
    for (const message of step.messages) await this.inbound(message, socket.ownerId).catch((error: unknown) => console.warn('discord inbound failed', error))
  }

  private async closed(code: number): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    if (socket === undefined) return
    // Every new socket identifies from scratch (ensure resets the state); the close code is only logged.
    if (code !== 1000) console.warn('discord gateway closed', code)
    // Back soon: the alarm wakes the Durable Object, which connects again.
    await this.setAlarm(Date.now() + 5_000)
  }
}
