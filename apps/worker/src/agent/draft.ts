/**
 * Drafts (v1.17 ticket 03, dp-si4p): a tool-call Ask of a send tool is shown to the owner as the message it would send. A send tool declares
 * where its recipients, subject, body and attachments are among its arguments (DraftShape); the Ask stores that shape with the call, and the
 * view reads the message from the stored arguments, so an edit of the arguments is exactly what Send sends (dp-qbt7). No new object: the
 * draft is the Ask, and its revisions live in the Ask's payload.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { DraftRevision, DraftView } from '@mr-robot/protocol'

/** Where a send tool keeps the parts of its message, by argument name. */
export interface DraftShape {
  readonly medium: 'email' | 'chat'
  /** The arguments that say who gets it, with the label the card shows ("To", "Channel", "In reply to"). */
  readonly recipients: ReadonlyArray<{ readonly argument: string; readonly label: string }>
  /** The subject argument; none for a chat message or an e-mail whose subject comes from the thread. */
  readonly subject?: string
  readonly body: string
  /** Workspace paths sent with it: an array of paths or one path. */
  readonly attachments?: string
}

/** The parameter every send tool takes (dp-yhn7). */
export const DRAFT_PARAMETER = 'draft'
export const DRAFT_PARAMETER_SCHEMA = { type: 'boolean', description: 'true: show this message to your owner as a draft first, even when you may send on your own. They edit it, then send or discard it. false when left out' }

const shapes = new WeakMap<ToolDefinition, DraftShape>()

/** Mark a tool as a send tool with this shape. */
export function withDraft(definition: ToolDefinition, shape: DraftShape): ToolDefinition {
  shapes.set(definition, shape)
  return definition
}

export function draftOf(definition: ToolDefinition): DraftShape | undefined {
  return shapes.get(definition)
}

const texts = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  : typeof value === 'string' && value.trim() !== '' ? value.split(',').map((item) => item.trim()).filter((item) => item !== '') : []

/** A stored shape (payload of any version); undefined when it is not one, as on an Ask stored before v1.17 (dp-f0pp). */
export function parseDraftShape(value: unknown): DraftShape | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const shape = value as Record<string, unknown>
  const medium = shape['medium']
  const body = shape['body']
  const listed = shape['recipients']
  if ((medium !== 'email' && medium !== 'chat') || typeof body !== 'string' || !Array.isArray(listed)) return undefined
  const recipients = listed.filter((entry): entry is { argument: string; label: string } => entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>)['argument'] === 'string' && typeof (entry as Record<string, unknown>)['label'] === 'string')
  const subject = shape['subject']
  const attachments = shape['attachments']
  return { medium, recipients, body, ...(typeof subject === 'string' ? { subject } : {}), ...(typeof attachments === 'string' ? { attachments } : {}) }
}

/** Stored revisions, oldest first; anything that is not one is left out. */
export function parseDraftRevisions(value: unknown): DraftRevision[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): DraftRevision[] => {
    if (entry === null || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const seq = row['seq']
    const body = row['body']
    const at = row['at']
    const by = row['by']
    if (typeof seq !== 'number' || typeof body !== 'string' || typeof at !== 'number' || (by !== 'robot' && by !== 'owner')) return []
    return [{ seq, body, subject: typeof row['subject'] === 'string' ? row['subject'] : null, at, by }]
  })
}

/** The message a stored call would send, as the card shows it. */
export function draftView(shape: DraftShape, args: Readonly<Record<string, unknown>>, revisions: readonly DraftRevision[]): DraftView {
  const body = args[shape.body]
  const subject = shape.subject === undefined ? undefined : args[shape.subject]
  return {
    medium: shape.medium,
    recipients: shape.recipients.flatMap(({ argument, label }) => texts(args[argument]).map((value) => ({ label, value }))),
    subject: shape.subject === undefined ? null : typeof subject === 'string' ? subject : '',
    body: typeof body === 'string' ? body : '',
    attachments: shape.attachments === undefined ? [] : texts(args[shape.attachments]),
    revisions: [...revisions],
  }
}

/** The arguments with a new body and subject; the rest of the call stays as stored. */
export function revisedArguments(shape: DraftShape, args: Readonly<Record<string, unknown>>, body: string, subject: string | undefined): Record<string, unknown> {
  return { ...args, [shape.body]: body, ...(shape.subject === undefined || subject === undefined ? {} : { [shape.subject]: subject }) }
}

/**
 * The revisions after one more version: the first change also keeps the version the Robot first wrote, so the history starts where the
 * draft did (dp-o3st).
 */
export function appendRevision(shape: DraftShape, before: Readonly<Record<string, unknown>>, revisions: readonly DraftRevision[], created: number, next: Omit<DraftRevision, 'seq'>): DraftRevision[] {
  const first = draftView(shape, before, [])
  const base: DraftRevision[] = revisions.length > 0 ? [...revisions] : [{ seq: 1, body: first.body, subject: first.subject, at: created, by: 'robot' }]
  return [...base, { ...next, seq: base.at(-1)!.seq + 1 }]
}

/** The draft as text, for a Channel without cards (dp-1tk6): who gets it, the subject and its first lines. */
export function draftText(view: DraftView): string {
  const to = view.recipients.map((entry) => `${entry.label}: ${entry.value}`).join('; ')
  const firstLines = view.body.split('\n').filter((line) => line.trim() !== '').slice(0, 3).join('\n')
  const subject = view.subject === null || view.subject === '' ? '' : ` "${view.subject}"`
  return [`wrote a draft for you to check${subject}${to === '' ? '' : ` (${to})`}.`, firstLines].filter((part) => part !== '').join('\n')
}
