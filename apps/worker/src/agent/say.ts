/**
 * Say (v1.15 ticket 01, gb-s81e): a Robot speaks to people only through the tool say. A successful call writes one
 * record into the session log; the Conversation, the search index and the Channels all read that record, so one
 * say is one message everywhere. Assistant text stays in the Trajectory and is not shown as a reply.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Attachment } from '@mr-robot/protocol'

/** The session record of one say. */
export const SAY_RECORD = 'plugin:mr-robot/say'

export interface SayRecord {
  /** The id of the message: the call's id. */
  readonly id: string
  readonly text: string
  readonly attachments: readonly Attachment[]
  /** The Channel address the say was sent to when the Robot named one. */
  readonly channel?: string
  /** The Turn said nothing: the platform showed the Turn's last assistant text instead (v1.15 ticket 02, gb-7jqy). */
  readonly fallback?: boolean
}

/** The say a session event records; undefined for any other event. */
export function sayOf(event: SessionEvent): SayRecord | undefined {
  if ((event.type as string) !== SAY_RECORD) return undefined
  const data = (event as { data?: unknown }).data as Partial<SayRecord> | undefined
  if (data === undefined || typeof data.id !== 'string' || typeof data.text !== 'string') return undefined
  return { id: data.id, text: data.text, attachments: Array.isArray(data.attachments) ? data.attachments : [], ...(typeof data.channel === 'string' ? { channel: data.channel } : {}), ...(data.fallback === true ? { fallback: true } : {}) }
}

/** The prefix of a stored screenshot's reference in a say's attachments: `screen:<name>`. */
export const SCREEN_PREFIX = 'screen:'

/** How many attachments one say may carry. */
export const SAY_MAX_ATTACHMENTS = 10

/** What the owner's message tells the Robot about the questions it moved past, after the message (gb-nr8s); the chat drops it (projection.ts). */
export const DISMISSED_TRAILER = /\n\n\[Platform: you asked [^\n]*\]$/

export function dismissedTrailer(asks: ReadonlyArray<{ readonly askId: string; readonly prompt: string }>): string {
  return `\n\n[Platform: you asked ${asks.map((ask) => `"${ask.prompt.replace(/\s+/g, ' ').slice(0, 120)}" (${ask.askId})`).join(' and ')}; your owner moved on without answering, so it was dismissed. Do not ask again.]`
}

// ---------------------------------------------------------------- the safety net (v1.15 ticket 02)

/** How the platform step that follows a Turn without a say begins (tests of the scripted model know it by this). */
export const SAFETY_NET_PREFIX = 'You ended your Turn without saying anything to'

/** The one bounded step (gb-xgd7): speak now, or end with no text. */
export const safetyNetNote = (owner: string): string =>
  `${SAFETY_NET_PREFIX} ${owner}. If ${owner} should hear something from this Turn, call say now. If nothing is to be said, end your Turn without text.`

/** The step ends after this many model requests started: a say, and its closing answer. */
export const SAFETY_NET_STEPS = 3

/** An owner Turn that runs this long without a say gets one steer (gb-0skq). */
export const QUIET_STEER_MS = 10 * 60_000

export const quietSteerNote = (owner: string): string => `${owner} has heard nothing from you for 10 minutes. Say where you are in a line or two, then go on.`
