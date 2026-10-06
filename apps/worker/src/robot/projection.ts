/**
 * The simple chat view of a Conversation (robot-q4b2), projected from the same session
 * log the Trajectory shows (robot-frf5). Nothing here is stored separately except notices.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Attachment, ChatItem, ProposalView, Sender } from '@mr-robot/protocol'
import type { NoticeRow } from './store.ts'

interface ContentBlock { readonly type: string; readonly text?: string }
interface MessageLike { readonly id: string; readonly content: readonly ContentBlock[]; readonly source?: Record<string, unknown> }

/** Tools whose use the chat already shows in their own way (a 👍 on the message). */
const HIDDEN_TOOLS = new Set(['react'])

const ROUTINE_TOOLS: Record<string, 'created' | 'updated' | 'deleted'> = {
  routine_create: 'created',
  routine_update: 'updated',
  routine_delete: 'deleted',
}
const QUESTION_TOOLS = new Set(['propose_grants', 'propose_member_file_edit', 'propose_skill', 'request_takeover', 'setup_complete'])

export interface ProjectionInput {
  readonly events: readonly SessionEvent[]
  readonly notices: readonly NoticeRow[]
  readonly proposal: (id: string) => ProposalView | undefined
}

export function projectChat(input: ProjectionInput): ChatItem[] {
  const items: ChatItem[] = []
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  const innerCalls = new Map<string, Array<{ name: string; args: Record<string, unknown> }>>()
  const notices = [...input.notices]
  let lastMemberMessage = -1

  const flushNotices = (seq: number) => {
    while (notices.length > 0 && notices[0]!.afterSeq < seq) {
      const notice = notices.shift()!
      items.push({ kind: 'notice', id: notice.id, seq: notice.afterSeq, at: notice.at, text: notice.text })
    }
  }

  for (const event of input.events) {
    flushNotices(event.seq)
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'user/message': {
        const message = data as unknown as MessageLike
        if (message.source?.['kind'] === 'compact-checkpoint') {
          // DSH's compaction checkpoint is for the model; the chat keeps the full history.
          items.push({ kind: 'notice', id: message.id, seq: event.seq, at: event.time, text: 'Earlier conversation condensed to fit the context budget.' })
          break
        }
        // DSH's own context messages (skill catalog, reminders) are for the model, not the chat.
        if (!CHAT_SOURCES.has(String(message.source?.['kind'] ?? 'member'))) break
        const sender = senderOf(message.source)
        if (sender.kind === 'platform') {
          // Conversations started before the chat text was split from the setup instruction.
          const raw = String(message.source?.['summary'] ?? '')
          const summary = raw.startsWith('Setup started.') ? 'Setup started' : raw
          if (summary.length > 0 && message.source?.['hidden'] !== true) {
            items.push({ kind: 'notice', id: message.id, seq: event.seq, at: event.time, text: summary })
          }
          break
        }
        if (sender.kind === 'routine') {
          items.push({ kind: 'routine', id: message.id, seq: event.seq, at: event.time, action: 'ran', name: sender.name })
          break
        }
        items.push({
          kind: 'message',
          id: message.id,
          seq: event.seq,
          at: event.time,
          sender,
          text: visibleText(message, sender),
          attachments: (message.source?.['attachments'] as Attachment[] | undefined) ?? [],
          reaction: null,
        })
        if (sender.kind === 'member') lastMemberMessage = items.length - 1
        break
      }
      case 'assistant/message': {
        const message = data['message'] as MessageLike | undefined
        const text = (message?.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('').trim()
        if (message !== undefined && text.length > 0) items.push({ kind: 'reply', id: message.id, seq: event.seq, at: event.time, text })
        break
      }
      case 'turn/end': {
        const reason = data['reason'] as { kind?: string; error?: { message?: string } } | undefined
        if (reason?.kind === 'error') {
          items.push({ kind: 'notice', id: `turn-error-${event.seq}`, seq: event.seq, at: event.time, text: `The Turn failed: ${reason.error?.message ?? 'unknown error'}` })
        }
        break
      }
      case 'tool/call': {
        const name = String(data['name'])
        const args = parseArgs(data['arguments'])
        calls.set(String(data['callId']), { name, args })
        if (name === 'react' && lastMemberMessage >= 0) {
          const target = items[lastMemberMessage]
          if (target?.kind === 'message') items[lastMemberMessage] = { ...target, reaction: String(args['emoji'] ?? '👍') }
        }
        break
      }
      case 'tool/ptc-dispatch': {
        // Code mode: the program's inner calls, shown once the program succeeds.
        const root = String(data['rootCallId'])
        const inner = innerCalls.get(root) ?? []
        inner.push({ name: String(data['name']), args: (data['arguments'] ?? {}) as Record<string, unknown> })
        innerCalls.set(root, inner)
        break
      }
      case 'tool/result': {
        const message = data['message'] as (MessageLike & { toolCallId?: string; isError?: boolean }) | undefined
        if (message === undefined || message.isError === true || data['error'] !== undefined) break
        const call = calls.get(String(message.toolCallId))
        if (call === undefined) break
        const inners = innerCalls.get(String(message.toolCallId)) ?? []
        // Compact activity: the step's tools, merged into one collapsed line per step.
        const used = [call.name === 'run_code' ? 'code' : call.name, ...inners.map((inner) => inner.name)].filter((name) => !HIDDEN_TOOLS.has(name))
        if (used.length > 0) {
          const previous = items.at(-1)
          if (previous?.kind === 'activity') items[items.length - 1] = { ...previous, tools: [...previous.tools, ...used] }
          else items.push({ kind: 'activity', id: 'activity-' + message.id, seq: event.seq, at: event.time, tools: used })
        }
        inners.forEach((inner, index) => {
          const innerAction = ROUTINE_TOOLS[inner.name]
          if (innerAction !== undefined) {
            items.push({ kind: 'routine', id: message.id + '-' + String(index), seq: event.seq, at: event.time, action: innerAction, name: String(inner.args['name'] ?? 'Routine') })
          } else if (inner.name === 'react' && lastMemberMessage >= 0) {
            const target = items[lastMemberMessage]
            if (target?.kind === 'message') items[lastMemberMessage] = { ...target, reaction: String(inner.args['emoji'] ?? '👍') }
          }
        })
        const result = parseResult(message)
        const action = ROUTINE_TOOLS[call.name]
        if (action !== undefined) {
          const name = String(result['name'] ?? call.args['name'] ?? 'Routine')
          items.push({ kind: 'routine', id: message.id, seq: event.seq, at: event.time, action, name })
        } else if (QUESTION_TOOLS.has(call.name) && typeof result['proposalId'] === 'string') {
          const proposal = input.proposal(result['proposalId'])
          if (proposal !== undefined) items.push({ kind: 'question', id: message.id, seq: event.seq, at: event.time, proposal })
        }
        break
      }
    }
  }
  flushNotices(Number.POSITIVE_INFINITY)
  return items
}

/** Message sources that are people, Robots, Routines, Channels or Mr. Robot's platform notes. */
const CHAT_SOURCES = new Set(['member', 'robot', 'routine', 'channel', 'platform'])

function senderOf(source: Record<string, unknown> | undefined): Sender {
  switch (source?.['kind']) {
    case 'member':
      return { kind: 'member', memberId: String(source['memberId']), name: String(source['name']) }
    case 'robot':
      return { kind: 'robot', robotId: String(source['robotId']), name: String(source['name']), avatarColor: String(source['avatarColor']) }
    case 'routine':
      return { kind: 'routine', routineId: String(source['routineId']), name: String(source['name']) }
    case 'channel':
      return { kind: 'channel', channel: String(source['channel']), from: String(source['from']) }
    case 'platform':
      return { kind: 'platform' }
    default:
      return { kind: 'member', memberId: '', name: '' }
  }
}

/** The text a person wrote, without the label line the model sees. */
function visibleText(message: MessageLike, sender: Sender): string {
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
  const body = sender.kind === 'member' ? text : text.replace(/^\[[^\n]*\]\n/, '')
  return body.replace(/\n\nAttached files \(in your workspace\): .*$/s, '')
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
  }
  return (value as Record<string, unknown> | undefined) ?? {}
}

function parseResult(message: MessageLike): Record<string, unknown> {
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('')
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}