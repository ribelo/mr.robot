/**
 * Message sources for everything that wakes a Robot. The model sees a label line
 * before the text; the chat view reads the structured source.
 */
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Attachment, Sender } from '@mr-robot/protocol'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    member: { kind: 'member'; memberId: string; name: string; attachments?: Attachment[]; clientId?: string } & ContextFormed
    robot: { kind: 'robot'; robotId: string; name: string; avatarColor: string; requestId?: string; replyTo?: string; threadId?: string; topic?: string } & ContextFormed
    routine: { kind: 'routine'; routineId: string; name: string } & ContextFormed
    channel: { kind: 'channel'; channel: string; from: string } & ContextFormed
    platform: { kind: 'platform'; summary: string } & ContextFormed
  }
}

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
}

export function wakeupMessage(input: WakeupMessageInput): UserMessage {
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
        `Your owner's scope for this Thread, the only thing you may use or disclose: ${thread.scope.trim() === '' ? '(nothing)' : '"' + thread.scope.replace(/\s*\n\s*/g, ' ⏎ ').trim() + '"'}.`,
        `Message ${thread.count}; reply with thread_send.${thread.windowCount >= THREAD_PAUSE_AT ? ` ${THREAD_PAUSE_AT} messages are used: report to your owner before you send more.` : ''}]`,
      ].join(' ')
      const head = thread !== undefined ? threadHead : input.replyTo === undefined
        ? `[Robot message from "${sender.name}" (${sender.robotId}), request ${input.requestId ?? '?'}${input.replyHandle === undefined ? '' : `; answer with robot_reply using handle ${input.replyHandle}`}]`
        : `[Reply from robot "${sender.name}" (${sender.robotId}) to your request ${input.replyTo}]`
      return createUserMessage({
        content: [{ type: 'text', text: `${head}\n${input.text}${files}` }],
        source: {
          kind: 'robot', robotId: sender.robotId, name: sender.name, avatarColor: sender.avatarColor, form: 'relay',
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
          ...(thread === undefined ? {} : { threadId: thread.id, topic: thread.topic }),
        },
      })
    }
    case 'routine':
      return createUserMessage({
        content: [{ type: 'text', text: `[Routine "${sender.name}" (${sender.routineId}) is due. Nobody is watching this turn.]\n${input.text}` }],
        source: { kind: 'routine', routineId: sender.routineId, name: sender.name },
      })
    case 'channel':
      return createUserMessage({
        content: [{ type: 'text', text: `[${sender.channel} message from ${sender.from}]\n${input.text}${files}` }],
        source: { kind: 'channel', channel: sender.channel, from: sender.from },
      })
    case 'platform':
      return createUserMessage({
        content: [{ type: 'text', text: `[Mr. Robot platform]\n${input.text}` }],
        source: { kind: 'platform', summary: input.summary ?? input.text.split('\n')[0]?.slice(0, 120) ?? '', form: 'notice' },
      })
  }
}
