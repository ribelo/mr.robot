/**
 * Message sources for everything that wakes a Robot. The model sees a label line
 * before the text; the chat view reads the structured source.
 */
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Attachment, Sender } from '@mr-robot/protocol'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    member: { kind: 'member'; memberId: string; name: string; attachments?: Attachment[] } & ContextFormed
    robot: { kind: 'robot'; robotId: string; name: string; avatarColor: string; requestId?: string; replyTo?: string } & ContextFormed
    routine: { kind: 'routine'; routineId: string; name: string } & ContextFormed
    channel: { kind: 'channel'; channel: string; from: string } & ContextFormed
    platform: { kind: 'platform'; summary: string } & ContextFormed
  }
}

export interface WakeupMessageInput {
  readonly sender: Sender
  readonly text: string
  readonly attachments?: readonly Attachment[]
  /** Robot message correlation, shown to the model. */
  readonly requestId?: string
  readonly replyTo?: string
  readonly replyHandle?: string
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
        source: { kind: 'member', memberId: sender.memberId, name: sender.name, attachments: [...attachments] },
      })
    case 'robot': {
      const head = input.replyTo === undefined
        ? `[Robot message from "${sender.name}" (${sender.robotId}), request ${input.requestId ?? '?'}${input.replyHandle === undefined ? '' : `; answer with robot_reply using handle ${input.replyHandle}`}]`
        : `[Reply from robot "${sender.name}" (${sender.robotId}) to your request ${input.replyTo}]`
      return createUserMessage({
        content: [{ type: 'text', text: `${head}\n${input.text}${files}` }],
        source: {
          kind: 'robot', robotId: sender.robotId, name: sender.name, avatarColor: sender.avatarColor, form: 'relay',
          ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
          ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
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
        source: { kind: 'platform', summary: input.text.split('\n')[0]?.slice(0, 120) ?? '', form: 'notice' },
      })
  }
}
