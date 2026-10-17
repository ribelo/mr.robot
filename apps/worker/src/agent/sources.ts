/**
 * Message sources for everything that wakes a Robot. The model sees a label line
 * before the text; the chat view reads the structured source.
 */
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Attachment, Sender } from '@mr-robot/protocol'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    member: { kind: 'member'; memberId: string; name: string; attachments?: Attachment[]; clientId?: string } & ContextFormed
    robot: { kind: 'robot'; robotId: string; name: string; avatarColor: string; avatarSeed: string; requestId?: string; replyTo?: string; threadId?: string; topic?: string } & ContextFormed
    task: { kind: 'task'; taskId: string; name: string; by: TaskRunBy } & ContextFormed
    channel: { kind: 'channel'; channel: string; from: string } & ContextFormed
    platform: { kind: 'platform'; summary: string } & ContextFormed
  }
}

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
  readonly thread?: ThreadWake
  /** What the chat shows for a platform message; defaults to its first line. */
  readonly summary?: string
  /** A Member's message: the id the app sent it with, so the app can match its pending copy. */
  readonly clientId?: string
  /** When the Robot woke and in which zone, for the time label every Wake-up carries; none leaves the label as it is. */
  readonly woke?: { readonly at: number; readonly timeZone: string }
  /** The platform message is the answer to a need_help request. */
  readonly helpAnswer?: HelpAnswerWake
  /** The platform message is the owner's answer to a tool-call Ask (sk-ed7r). */
  readonly toolCallAnswer?: ToolCallAnswerLabel
  /** A Task's Wake-up: who started it, and the person's name for Run now. */
  readonly taskRun?: { readonly by: TaskRunBy; readonly who?: string }
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

function platformLabel(input: WakeupMessageInput): string {
  if (input.toolCallAnswer !== undefined) return toolCallAnswerLabel(input.toolCallAnswer)
  if (input.helpAnswer === undefined) return '[Mr. Robot platform]'
  // The owner answered once more after Mr. Robot did (sk-q86i).
  return input.helpAnswer.afterMrRobot === true
    ? `[Your owner answered your request ${input.helpAnswer.requestId} (after Mr. Robot)]`
    : `[Answer to your request ${input.helpAnswer.requestId} from ${input.helpAnswer.from}]`
}

/** The answer to a Robot's need_help request: the request id and who answered ("Anna", "Mr. Robot"). */
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

/** The time label alone on the first line of a Member's message: the pattern the chat view drops. */
export const MEMBER_TIME_LABEL = /^\[[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2} [^\]\n]+\]\n/

/**
 * A Wake-up as the model reads it: the label of its source (sourceMessage) with the local time in front.
 * A Member's message has no label of its own, so its time is a line of its own; every other label gets
 * the time on the same line, which keeps it one label line.
 */
export function wakeupMessage(input: WakeupMessageInput): UserMessage {
  const message = sourceMessage(input)
  if (input.woke === undefined) return message
  const time = timeLabel(input.woke.at, input.woke.timeZone)
  const [first, ...rest] = message.content
  if (first?.type !== 'text') return message
  const text = input.sender.kind === 'member' ? `${time}\n${first.text}` : `${time} ${first.text}`
  return { ...message, content: [{ ...first, text }, ...rest] }
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
        ? `[Robot message from "${sender.name}" (${sender.robotId}), request ${input.requestId ?? '?'}${input.replyHandle === undefined ? '' : `; answer with robot_reply using handle ${input.replyHandle}`}]`
        : `[Reply from robot "${sender.name}" (${sender.robotId}) to your request ${input.replyTo}]`
      return createUserMessage({
        content: [{ type: 'text', text: `${head}\n${input.text}${files}` }],
        source: {
          kind: 'robot', robotId: sender.robotId, name: sender.name, avatarColor: sender.avatarColor, avatarSeed: sender.avatarSeed, form: 'relay',
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
          ...(thread === undefined ? {} : { threadId: thread.id, topic: thread.topic }),
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
