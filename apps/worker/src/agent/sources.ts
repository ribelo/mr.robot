/**
 * Message sources for everything that wakes a Robot. The model sees a label line
 * before the text; the chat view reads the structured source.
 */
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Attachment, Sender } from '@mr-robot/protocol'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    member: { kind: 'member'; memberId: string; name: string; attachments?: Attachment[]; clientId?: string; joined?: JoinedPart[] } & Delivered & ContextFormed
    robot: { kind: 'robot'; robotId: string; name: string; avatarColor: string; avatarSeed: string; requestId?: string; replyTo?: string; threadId?: string; topic?: string; question?: true } & Delivered & ContextFormed
    task: { kind: 'task'; taskId: string; name: string; by: TaskRunBy } & ContextFormed
    channel: { kind: 'channel'; channel: string; from: string; joined?: JoinedPart[] } & Delivered & ContextFormed
    platform: { kind: 'platform'; summary: string } & Delivered & ContextFormed
  }
}

/** A steer records the Wake-up it came from (v1.14, ao-lfxt); the log shows it where the Robot read it. */
export interface Delivered {
  wakeupId?: number
  delivery?: 'steer'
}

/** One of several queued follow-ups from the same sender joined into one message (ao-rdhs). */
export interface JoinedPart {
  clientId?: string
  attachments: Attachment[]
}

/** The line between joined follow-ups; the platform prompt tells the Robot what it means. */
export const JOIN_SEPARATOR = '\n\n--- next message from the same sender ---\n'

/** Who started a Task's Turn (mc-s1aa): its schedule, a person (Run now), or a Robot. */
export type TaskRunBy = 'schedule' | 'member' | 'robot'

/** A scope on one line, for the label the model reads before a Thread message. */
export const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ⏎ ').trim()

/** A chief reports to its owner after this many messages in a Thread (ch-408z). */
export const THREAD_PAUSE_AT = 20

/** What a Thread message carries to the chief that receives it (ch-6ymu): the Thread, its topic and the receiver's own scope. */
export interface ThreadWake {
  readonly id: string
  readonly topic: string
  readonly scope: string
  /** Messages in the Thread so far. */
  readonly count: number
  /** Messages since this chief's owner last let the Thread go on. */
  readonly windowCount: number
}

export interface WakeupMessageInput {
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  /** Robot message correlation, shown to the model. */
  readonly requestId?: string
  readonly replyTo?: string
  readonly replyHandle?: string
  /** The Robot message is a question, not work (v1.15, gb-l1x1). */
  readonly question?: boolean
  readonly thread?: ThreadWake
  /** What the chat shows for a platform message; defaults to its first line. */
  readonly summary?: string
  /** A Member's message: the id the app sent it with, so the app can match its pending copy. */
  readonly clientId?: string
  /** When the Robot woke and in which zone, for the time label every Wake-up carries; none leaves the label as it is. */
  readonly woke?: { readonly at: number; readonly timeZone: string }
  /** The platform message is the answer to a help request left open from before v1.15 (need_help is gone). */
  readonly helpAnswer?: HelpAnswerWake
  /** The platform message is the owner's answer to a tool-call Ask (sk-ed7r). */
  readonly toolCallAnswer?: ToolCallAnswerLabel
  /** The platform message is the owner's answer to a question or credential Ask (v1.15). */
  readonly askAnswer?: AskAnswerLabel
  /** A Task's Wake-up: who started it, and the person's name for Run now. */
  readonly taskRun?: { readonly by: TaskRunBy; readonly who?: string }
  /** The Wake-up reached a running Turn as a steer. */
  readonly steer?: { readonly wakeupId: number }
  /** The first Wake-up after a Rewind: its label, "[Rewound to …: external effects since then stand: …]", after the time (v1.19, ec-utsf). */
  readonly rewound?: string
}

/** The owner's answer to a tool-call Ask, as its label names it. */
export interface ToolCallAnswerLabel {
  readonly askId: string
  readonly tool: string
  readonly approved: boolean
  readonly note: string | null
}

/** "[Your owner approved gmail_send (p-…)]" or "[Your owner rejected gmail_send (p-…): not now]". */
export function toolCallAnswerLabel(answer: ToolCallAnswerLabel): string {
  return answer.approved
    ? `[Your owner approved ${answer.tool} (${answer.askId})]`
    : `[Your owner rejected ${answer.tool} (${answer.askId})${answer.note === null ? '' : `: ${oneLine(answer.note)}`}]`
}

/** The owner's answer to a question Ask or a credential Ask (v1.15), as the label names it. */
export type AskAnswerLabel =
  | { readonly askId: string; readonly kind: 'option'; readonly label: string; readonly value: string }
  /** A multi-select answer (v1.17, dp-f8z1): every chosen option, and whether the owner's words follow in the text. */
  | { readonly askId: string; readonly kind: 'selected'; readonly labels: readonly string[]; readonly values: readonly string[]; readonly withText: boolean }
  | { readonly askId: string; readonly kind: 'custom' }
  | { readonly askId: string; readonly kind: 'dismissed' }
  | { readonly askId: string; readonly kind: 'credential-saved'; readonly entry: string }
  | { readonly askId: string; readonly kind: 'credential-declined' }

/** "[Your owner answered your question p-… : \"Yes, send it\" (value: send)]". */
export function askAnswerLabel(answer: AskAnswerLabel): string {
  switch (answer.kind) {
    case 'option': return `[Your owner answered your question ${answer.askId}: "${oneLine(answer.label)}" (value: ${oneLine(answer.value)})]`
    case 'selected': return `[Your owner answered your question ${answer.askId}: ${answer.labels.map((label) => `"${oneLine(label)}"`).join(', ')} (values: ${answer.values.map(oneLine).join(', ')})${answer.withText ? ', with their own words' : ''}]`
    case 'custom': return `[Your owner answered your question ${answer.askId} in their own words]`
    case 'dismissed': return `[Your owner dismissed your question ${answer.askId}]`
    case 'credential-saved': return `[Your owner saved the login or secret you asked for (${answer.askId}): its name is ${answer.entry}]`
    case 'credential-declined': return `[Your owner declined your request for a login or secret (${answer.askId})]`
  }
}

function platformLabel(input: WakeupMessageInput): string {
  if (input.askAnswer !== undefined) return askAnswerLabel(input.askAnswer)
  if (input.toolCallAnswer !== undefined) return toolCallAnswerLabel(input.toolCallAnswer)
  if (input.helpAnswer === undefined) return '[Mr. Robot platform]'
  // The owner answered once more after Mr. Robot did (sk-q86i).
  return input.helpAnswer.afterMrRobot === true
    ? `[Your owner answered your request ${input.helpAnswer.requestId} (after Mr. Robot)]`
    : `[Answer to your request ${input.helpAnswer.requestId} from ${input.helpAnswer.from}]`
}

/** The answer to a help request left open from before v1.15: the request id and who answered ("Anna", "Mr. Robot" before v1.15). */
export interface HelpAnswerWake {
  readonly requestId: string
  readonly from: string
  /** The owner's answer after Mr. Robot had answered: it overrides his. */
  readonly afterMrRobot?: true
}

/** The local time of a Wake-up as the model reads it: "[Sat 2026-10-10 11:46 Europe/Warsaw]". */
export function timeLabel(at: number, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).map((part) => [part.type, part.value]))
  return `[${parts['weekday']} ${parts['year']}-${parts['month']}-${parts['day']} ${parts['hour']}:${parts['minute']} ${timeZone}]`
}

/** The time label (and a Rewind's label after it, v1.19) alone on the first line of a Member's message: the pattern the chat view drops. */
export const MEMBER_TIME_LABEL = /^\[[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2} [^\]\n]+\](?: \[Rewound to [^\n]*\])?\n/

/**
 * A Wake-up as the model reads it: the label of its source (sourceMessage) with the local time in front.
 * A Member's message has no label of its own, so its time is a line of its own; every other label gets
 * the time on the same line, which keeps it one label line.
 */
export function wakeupMessage(input: WakeupMessageInput): UserMessage {
  const sourced = sourceMessage(input)
  const message = input.steer === undefined || sourced.source?.kind === 'task'
    ? sourced
    : { ...sourced, source: { ...sourced.source, wakeupId: input.steer.wakeupId, delivery: 'steer' } } as UserMessage
  if (input.woke === undefined) return message
  const time = input.rewound === undefined ? timeLabel(input.woke.at, input.woke.timeZone) : `${timeLabel(input.woke.at, input.woke.timeZone)} ${input.rewound}`
  const [first, ...rest] = message.content
  if (first?.type !== 'text') return message
  const text = input.sender.kind === 'member' ? `${time}\n${first.text}` : `${time} ${first.text}`
  return { ...message, content: [{ ...first, text }, ...rest] }
}

/**
 * Several queued follow-ups from one sender as one message (ao-rdhs): their texts, each with its own labels,
 * between separators; the source of the first, with each part's id and attachments so the chat shows them apart.
 */
export function joinedMessage(messages: readonly UserMessage[], parts: readonly JoinedPart[]): UserMessage {
  const [first] = messages
  if (first === undefined) throw new Error('nothing to join')
  if (messages.length === 1) return first
  const text = messages.map((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')).join(JOIN_SEPARATOR)
  const { clientId: _clientId, ...source } = first.source as Record<string, unknown>
  const attachments = parts.flatMap((part) => part.attachments)
  return { ...first, content: [{ type: 'text', text }], source: { ...source, ...(source['kind'] === 'member' ? { attachments } : {}), joined: [...parts] } } as unknown as UserMessage
}

function sourceMessage(input: WakeupMessageInput): UserMessage {
  const { sender } = input
  const attachments = input.attachments ?? []
  const files = attachments.length === 0
    ? ''
    : `\n\nAttached files (in your workspace): ${attachments.map((file) => file.path).join(', ')}`
  switch (sender.kind) {
    case 'member':
      return createUserMessage({
        content: [{ type: 'text', text: `${input.text}${files}` }],
        source: { kind: 'member', memberId: sender.memberId, name: sender.name, attachments: [...attachments], ...(input.clientId === undefined ? {} : { clientId: input.clientId }) },
      })
    case 'robot': {
      const thread = input.thread
      // One line, so the chat can drop it; the scope stays on a single line for the model.
      const threadHead = thread === undefined ? '' : [
        `[Thread message from "${sender.name}" (${sender.robotId}) in Thread ${thread.id}, topic: "${thread.topic.replace(/\s+/g, ' ')}".`,
        `Your owner's scope for this Thread, the only thing you may use or disclose: ${thread.scope.trim() === '' ? '(nothing)' : '"' + oneLine(thread.scope) + '"'}.`,
        `Message ${thread.count}; reply with thread_send.${thread.windowCount >= THREAD_PAUSE_AT ? ` ${THREAD_PAUSE_AT} messages are used: report to your owner before you send more.` : ''}]`,
      ].join(' ')
      const head = thread !== undefined ? threadHead : input.replyTo === undefined
        ? `[${input.question === true ? 'Question from' : 'Robot message from'} "${sender.name}" (${sender.robotId}), request ${input.requestId ?? '?'}${input.replyHandle === undefined ? '' : `; answer with robot_reply using handle ${input.replyHandle}`}]`
        : `[Reply from robot "${sender.name}" (${sender.robotId}) to your request ${input.replyTo}]`
      return createUserMessage({
        content: [{ type: 'text', text: `${head}\n${input.text}${files}` }],
        source: {
          kind: 'robot', robotId: sender.robotId, name: sender.name, avatarColor: sender.avatarColor, avatarSeed: sender.avatarSeed, form: 'relay',
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
          ...(thread === undefined ? {} : { threadId: thread.id, topic: thread.topic }),
          ...(input.question === true ? { question: true as const } : {}),
        },
      })
    }
    case 'task': {
      const run = input.taskRun ?? { by: 'schedule' as const }
      const head = run.by === 'schedule'
        ? `[Task "${sender.name}" (${sender.taskId}) is due. Nobody is watching this turn. When the Task is finished, call task_done.]`
        : `[Task "${sender.name}" (${sender.taskId}): ${run.who ?? 'your owner'} asked you to run it now. When the Task is finished, call task_done.]`
      return createUserMessage({
        content: [{ type: 'text', text: `${head}\n${input.text}` }],
        source: { kind: 'task', taskId: sender.taskId, name: sender.name, by: run.by },
      })
    }
    case 'channel':
      return createUserMessage({
        content: [{ type: 'text', text: `[${sender.channel} message from ${sender.from}]\n${input.text}${files}` }],
        source: { kind: 'channel', channel: sender.channel, from: sender.from },
      })
    case 'platform':
      return createUserMessage({
        content: [{ type: 'text', text: `${platformLabel(input)}\n${input.text}` }],
        source: { kind: 'platform', summary: input.summary ?? input.text.split('\n')[0]?.slice(0, 120) ?? '', form: 'notice' },
      })
  }
}
