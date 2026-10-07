/**
 * Memory as a plugin (v1.3 ticket 02): before each model step the Robot's memory enters the context
 * as a durable user message, never the system prompt (pl-w3n0): the full baseline when the session
 * has none (first step, after compaction, after a rewind), otherwise a note naming the files that
 * changed since (pl-9n7w). Also the tools that change shared memory: Mr. Robot writes owner and
 * Home files, other Robots propose edits (pl-o3ck, pl-yqno).
 */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { renderBaseline, renderChanges, type MemoryChange, type MemoryFile } from '../agent/memory.ts'
import { tool } from '../agent/tools/define.ts'
import { capability } from './define.ts'

export const SHARED_FILES = ['USER.md', 'PROACTIVE_PREFERENCES.md', 'memory/world.md', 'HOME.md'] as const
export type SharedFile = (typeof SHARED_FILES)[number]

export interface MemoryHost {
  /** Every memory file in scope, read fresh. */
  memoryFiles(): Promise<MemoryFile[]>
  /** Edits made by others since the last delivery. */
  memoryChanges(): MemoryChange[]
  /** Whether this session's context lacks a current baseline. */
  needsBaseline(sessionId: string): boolean
  /** The message entered the context: clear pending changes; a baseline marks the session current. */
  memoryDelivered(sessionId: string, baseline: boolean): void
  /** Mr. Robot only: write an owner or Home file directly. */
  writeShared?(file: SharedFile, content: string): Promise<void>
  /** Other Robots: ask the owner to approve an edit. */
  propose(kind: 'member-file', purpose: string, payload: Record<string, unknown>): { id: string }
}

export interface MemoryConfig {
  readonly host: MemoryHost
  readonly maxBytes: number
  /** The shared-memory tools; off during setup. */
  readonly tools: boolean
}

const memoryMessage = (text: string, form: 'baseline' | 'changes'): UserMessage => createUserMessage({
  content: [{ type: 'text', text }],
  // A platform message without a summary stays out of the chat.
  source: { kind: 'platform', summary: '', form: 'notice', hidden: true, memory: form } as never,
})

const isMemory = (message: unknown) => (message as { source?: { memory?: unknown } }).source?.memory !== undefined

function memoryTools(config: MemoryConfig) {
  const { host } = config
  if (!config.tools) return []
  if (host.writeShared !== undefined) {
    const write = host.writeShared.bind(host)
    return [tool<{ file: SharedFile; content: string }>({
      name: 'memory_write_shared',
      description: "Write the complete new version of one of your owner's shared memory files (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md) or the Home's HOME.md. Every Robot that reads it is told it changed.",
      parameters: { properties: { file: { type: 'string', enum: [...SHARED_FILES] }, content: { type: 'string' } }, required: ['file', 'content'] },
      execute: async ({ file, content }) => {
        if (!SHARED_FILES.includes(file)) throw new Error(`only ${SHARED_FILES.join(', ')} are shared memory files`)
        await write(file, content)
        return { written: file }
      },
    })]
  }
  return [tool<{ file: SharedFile; content: string; purpose: string }>({
    name: 'propose_member_file_edit',
    description: "Propose a new full version of a shared memory file: your owner's USER.md, PROACTIVE_PREFERENCES.md or memory/world.md, or the Home's HOME.md, with what you learned. Your owner approves or rejects it.",
    parameters: {
      properties: {
        file: { type: 'string', enum: [...SHARED_FILES] },
        content: { type: 'string', description: 'The complete new file' },
        purpose: { type: 'string', description: 'What changed and why, in one sentence' },
      },
      required: ['file', 'content', 'purpose'],
    },
    execute: async ({ file, content, purpose }) => {
      if (!SHARED_FILES.includes(file)) throw new Error(`Only ${SHARED_FILES.join(', ')} can be proposed`)
      const proposal = host.propose('member-file', purpose, { file: { name: file, content } })
      return { proposalId: proposal.id, status: 'waiting for your owner' }
    },
  })]
}

const base = capability<MemoryConfig>({
  name: 'memory',
  Config: z.object({ host: z.any().required(), maxBytes: z.number().default(32_768), tools: z.boolean().default(true) }) as never,
  tools: memoryTools,
})

type PreStepDecision = { kind: string; messages: readonly UserMessage[] }
type PreStep = (input: { agent: { session: string }; messages: readonly UserMessage[]; step: number }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>

export const Memory = {
  ...base,
  async apply(ctx: Parameters<typeof base.apply>[0], config: MemoryConfig) {
    await base.apply(ctx, config)
    const on = ctx as unknown as { on(event: 'agent/pre-step', listener: PreStep): void }
    on.on('agent/pre-step', async ({ agent, messages, step }, next) => {
      const decision = await next()
      // A rejected step, or an empty first step that only owns a no-step turn, carries nothing.
      if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) return decision
      if (decision.messages.some(isMemory)) return decision
      const sessionId = String(agent.session)
      const baseline = config.host.needsBaseline(sessionId)
      const changes = config.host.memoryChanges()
      if (!baseline && changes.length === 0) return decision
      const files = await config.host.memoryFiles()
      const message = baseline ? memoryMessage(renderBaseline(files, config.maxBytes), 'baseline') : memoryMessage(renderChanges(changes, files, config.maxBytes), 'changes')
      config.host.memoryDelivered(sessionId, baseline)
      // Right after the claimed batch: the wake-up message first, then the memory it should be read with.
      const last = decision.messages.findLastIndex((entry) => messages.includes(entry))
      return { ...decision, messages: decision.messages.toSpliced(last + 1, 0, message) }
    })
  },
}
