/**
 * Discord's gateway as a state machine (v1.5 ticket 05): Discord needs a WebSocket to receive events,
 * so a Durable Object holds one. This file is pure: it turns gateway payloads into the frames to send
 * and the messages that arrived, so the socket handling stays a thin shell.
 *
 * Discord's protocol: HELLO (op 10) gives the heartbeat interval, the client sends IDENTIFY (op 2),
 * the server sends DISPATCH (op 0) events; a disconnect in the 4000s must not be resumed.
 */
import * as Schema from 'effect/Schema'

/** A Worker opens an outgoing WebSocket with fetch and an https:// address (Upgrade header), not wss://. */
export const GATEWAY_URL = 'https://gateway.discord.gg/?v=10&encoding=json'

const Payload = Schema.Struct({
  op: Schema.Number,
  t: Schema.optional(Schema.NullOr(Schema.String)),
  s: Schema.optional(Schema.NullOr(Schema.Number)),
  d: Schema.optional(Schema.Unknown),
})
export type Payload = typeof Payload.Type

const MessageCreate = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  guild_id: Schema.optional(Schema.String),
  content: Schema.String,
  author: Schema.Struct({ id: Schema.String, username: Schema.String, global_name: Schema.optional(Schema.NullOr(Schema.String)), bot: Schema.optional(Schema.Boolean) }),
  webhook_id: Schema.optional(Schema.String),
})

/** A message that arrived on Discord, ready to become a Wake-up. */
export interface GatewayMessage {
  readonly id: string
  readonly channelId: string
  readonly guildId: string | null
  readonly authorId: string
  readonly authorName: string
  readonly text: string
  readonly direct: boolean
}

export interface GatewayState {
  /** The session Discord gave us: what RESUME needs after a dropped socket. */
  readonly sessionId: string | null
  readonly resumeUrl: string | null
  readonly sequence: number | null
  /** Milliseconds between heartbeats, from HELLO. */
  readonly heartbeatMs: number
  readonly identified: boolean
}

export const initialGateway: GatewayState = { sessionId: null, resumeUrl: null, sequence: null, heartbeatMs: 45_000, identified: false }

export interface GatewayStep {
  readonly state: GatewayState
  /** Frames to send, as JSON text, in order. */
  readonly send: readonly string[]
  readonly messages: readonly GatewayMessage[]
  /** The socket must be dropped and opened again (Discord asked for a reconnect). */
  readonly reconnect: boolean
}

const frame = (op: number, d: unknown): string => JSON.stringify({ op, d })

export function identify(token: string, intents: number): string {
  return frame(2, { token, intents, properties: { os: 'linux', browser: 'mr-robot', device: 'mr-robot' }, compress: false })
}

/** The intents a bot needs: guild messages, direct messages and their content. */
export const INTENTS = 1 + 512 + 4096 + 8192 + 32768

export function heartbeat(state: GatewayState): string {
  return frame(1, state.sequence)
}

/** One gateway payload applied to the state. */
export function gatewayStep(state: GatewayState, payload: Payload, token: string): GatewayStep {
  const sequence = payload.s === undefined || payload.s === null ? state.sequence : payload.s
  switch (payload.op) {
    case 10: {
      const hello = Schema.decodeUnknownOption(Schema.Struct({ heartbeat_interval: Schema.Number }))(payload.d)
      const heartbeatMs = hello._tag === 'Some' ? hello.value.heartbeat_interval : state.heartbeatMs
      // A stored session resumes; otherwise the bot identifies (Discord closes a resumed socket with 4000s if it cannot).
      const helloState = { ...state, heartbeatMs, sequence }
      if (state.sessionId !== null && state.sequence !== null) {
        return { state: helloState, send: [frame(6, { token, session_id: state.sessionId, seq: state.sequence })], messages: [], reconnect: false }
      }
      return { state: helloState, send: [identify(token, INTENTS)], messages: [], reconnect: false }
    }
    case 11:
      // Heartbeat acknowledged.
      return { state: { ...state, sequence }, send: [], messages: [], reconnect: false }
    case 1:
      return { state: { ...state, sequence }, send: [heartbeat({ ...state, sequence })], messages: [], reconnect: false }
    case 7:
      // Discord asks the client to reconnect; the session is resumed on the new socket.
      return { state: { ...state, sequence }, send: [], messages: [], reconnect: true }
    case 9:
      // An invalid session: identify from scratch.
      return { state: { ...initialGateway, heartbeatMs: state.heartbeatMs }, send: [identify(token, INTENTS)], messages: [], reconnect: false }
    case 0: {
      const dispatch = { ...state, sequence, identified: state.identified || payload.t === 'READY' }
      if (payload.t === 'READY') {
        const ready = Schema.decodeUnknownOption(Schema.Struct({ session_id: Schema.String, resume_gateway_url: Schema.String }))(payload.d)
        return { state: { ...dispatch, sessionId: ready._tag === 'Some' ? ready.value.session_id : state.sessionId, resumeUrl: ready._tag === 'Some' ? ready.value.resume_gateway_url : state.resumeUrl }, send: [], messages: [], reconnect: false }
      }
      if (payload.t === 'RESUMED') return { state: dispatch, send: [], messages: [], reconnect: false }
      if (payload.t !== 'MESSAGE_CREATE') return { state: dispatch, send: [], messages: [], reconnect: false }
      const decoded = Schema.decodeUnknownOption(MessageCreate)(payload.d)
      if (decoded._tag === 'None' || decoded.value.author.bot === true || decoded.value.webhook_id !== undefined) return { state: dispatch, send: [], messages: [], reconnect: false }
      const text = decoded.value.content.trim()
      if (text === '') return { state: dispatch, send: [], messages: [], reconnect: false }
      return {
        state: dispatch,
        send: [],
        reconnect: false,
        messages: [{
          id: decoded.value.id,
          channelId: decoded.value.channel_id,
          guildId: decoded.value.guild_id ?? null,
          authorId: decoded.value.author.id,
          authorName: decoded.value.author.global_name ?? decoded.value.author.username,
          text,
          direct: decoded.value.guild_id === undefined,
        }],
      }
    }
    default:
      return { state: { ...state, sequence }, send: [], messages: [], reconnect: false }
  }
}

/**
 * What a closed gateway socket means (Discord's close codes). fatal: the same token can never connect
 * (bad token, intents or version), so the bot stops until its token changes; identify: open a new
 * session; resume: connect again and resume the session.
 */
export type CloseVerdict = 'fatal' | 'identify' | 'resume'

const FATAL_CLOSES: ReadonlySet<number> = new Set([4004, 4010, 4011, 4012, 4013, 4014])
const FRESH_CLOSES: ReadonlySet<number> = new Set([1000, 1001, 4007, 4009])

export function closeVerdict(code: number): CloseVerdict {
  if (FATAL_CLOSES.has(code)) return 'fatal'
  if (FRESH_CLOSES.has(code)) return 'identify'
  return 'resume'
}

/** At most this many gateway connections per 24 hours; Discord resets a bot's token after about 1000. */
export const DAILY_CONNECTS = 100
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const FIRST_RETRY = 5_000
const LONGEST_RETRY = 10 * 60 * 1000

/**
 * When the next connection may start, from the times of earlier ones. Each connection within the
 * last hour doubles the wait after the newest one (5 s, 10 s, 20 s … at most 10 minutes), and the
 * daily budget holds the rest until the oldest connection of the last 24 hours is a day old.
 * The times are stored, so the rule holds across restarts of the Durable Object.
 */
export function nextConnectAt(connects: readonly number[], now: number): number {
  const day = connects.filter((at) => at > now - DAY).sort((a, b) => a - b)
  if (day.length >= DAILY_CONNECTS) return day[day.length - DAILY_CONNECTS]! + DAY
  const hour = day.filter((at) => at > now - HOUR)
  if (hour.length === 0) return now
  const wait = Math.min(LONGEST_RETRY, FIRST_RETRY * 2 ** (hour.length - 1))
  return Math.max(now, hour[hour.length - 1]! + wait)
}

/** Where a resumed session connects: Discord's resume address, as the https:// URL a Worker needs. */
export function resumeAddress(resumeUrl: string): string {
  return `${resumeUrl.replace(/^wss:/, 'https:').replace(/\/+$/, '')}/?v=10&encoding=json`
}

/** Parse a frame from Discord; an unreadable one is ignored (Discord adds fields over time). */
export function readPayload(text: string): Payload | null {
  try {
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Payload))(text)
    return decoded._tag === 'Some' ? decoded.value : null
  } catch {
    return null
  }
}
