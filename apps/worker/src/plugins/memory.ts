/**
 * Memory as a plugin (v1.3 ticket 02): before each model step the Robot's memory enters the context
 * as a durable user message, never the system prompt (pl-w3n0): the full baseline when the session
 * has none (first step, after compaction, after a rewind), otherwise a note naming the files that
 * changed since (pl-9n7w). Also the tools that change shared memory: Mr. Robot writes owner and
 * Space files, other Robots propose edits (pl-o3ck, pl-yqno).
 */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { renderBaseline, renderChanges, type MemoryChange, type MemoryFile, type SharedFileEdit } from '../agent/memory.ts'
import { tool } from '../agent/tools/define.ts'
import { capability } from './define.ts'
import type { MemoryMatch } from '../robot/memory-index.ts'

export const SHARED_FILES = ['USER.md', 'PROACTIVE_PREFERENCES.md', 'memory/world.md', 'SPACE.md'] as const
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
  /** How this Robot changes owner and Space files, by its kind (v1.11, sk-a2yy). */
  readonly shared: SharedFiles
  /** memory_search over the memory index (v1.20, dm-hmet). */
  search(query: string, limit?: number): Promise<readonly MemoryMatch[]>
}

/** Mr. Robot writes owner and Space files directly; other Robots ask the owner to approve an edit. */
export type SharedFiles =
  | { readonly kind: 'mr-robot'; write(file: SharedFile, content: string): Promise<void> }
  | { readonly kind: 'robot'; propose(kind: 'member-file', purpose: string, payload: Record<string, unknown>): { id: string } }

/** What the memory header says about shared files: only the tool this Robot has (none while tools are off). */
export function sharedFileEdit(kind: SharedFiles['kind'], tools: boolean): SharedFileEdit {
  if (!tools) return 'none'
  return kind === 'mr-robot' ? 'write' : 'propose'
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

/** memory_search (v1.20, dm-hmet, dm-g4in): read-only, so a Subagent has it too. */
function searchTool(host: MemoryHost) {
  return tool<{ query: string; limit?: number }>({
    name: 'memory_search',
    description: 'Search your memory: MEMORY.md, AGENTS.md, SOUL.md, your daily notes (memory/) and dreams (dreams/), your owner\'s files and SPACE.md. Words match as written, and a word also matches longer words it begins. Returns the best paragraphs first: path, lines, the note\'s date, a snippet. Read a file with read for the whole of it; read today\'s daily note when you need the thread of the day.',
    parameters: { properties: { query: { type: 'string', description: 'The words to find' }, limit: { type: 'number', description: 'How many matches, 10 when left out, at most 50' } }, required: ['query'] },
    execute: async ({ query, limit }) => ({ matches: await host.search(query, limit) }),
  })
}

function memoryTools(config: MemoryConfig) {
  const { shared } = config.host
  if (!config.tools) return []
  const search = searchTool(config.host)
  if (shared.kind === 'mr-robot') {
    const write = shared.write.bind(shared)
    return [search, tool<{ file: SharedFile; content: string }>({
      name: 'memory_write_shared',
      description: "Write the complete new version of one of your owner's shared memory files (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md) or the Space's SPACE.md. Every Robot that reads it is told it changed.",
      parameters: { properties: { file: { type: 'string', enum: [...SHARED_FILES], description: 'Which shared memory file to write' }, content: { type: 'string', description: 'The complete new file' } }, required: ['file', 'content'] },
      emptyAllowed: ['content'],
      execute: async ({ file, content }) => {
        if (!SHARED_FILES.includes(file)) throw new Error(`only ${SHARED_FILES.join(', ')} are shared memory files`)
        await write(file, content)
        return { written: file }
      },
    })]
  }
  return [search, tool<{ file: SharedFile; content: string; purpose: string }>({
    name: 'propose_member_file_edit',
    description: "Propose a new full version of a shared memory file: your owner's USER.md, PROACTIVE_PREFERENCES.md or memory/world.md, or the Space's SPACE.md, with what you learned. Your owner approves or rejects it.",
    parameters: {
      properties: {
        file: { type: 'string', enum: [...SHARED_FILES], description: 'Which shared memory file to write' },
        content: { type: 'string', description: 'The complete new file' },
        purpose: { type: 'string', description: 'What changed and why, in one sentence' },
      },
      required: ['file', 'content', 'purpose'],
    },
    emptyAllowed: ['content'],
    execute: async ({ file, content, purpose }) => {
      if (!SHARED_FILES.includes(file)) throw new Error(`Only ${SHARED_FILES.join(', ')} can be proposed`)
      const proposal = shared.propose('member-file', purpose, { file: { name: file, content } })
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
      const message = baseline ? memoryMessage(renderBaseline(files, config.maxBytes, sharedFileEdit(config.host.shared.kind, config.tools)), 'baseline') : memoryMessage(renderChanges(changes, files, config.maxBytes), 'changes')
      config.host.memoryDelivered(sessionId, baseline)
      // Right after the claimed batch: the wake-up message first, then the memory it should be read with.
      const last = decision.messages.findLastIndex((entry) => messages.includes(entry))
      return { ...decision, messages: decision.messages.toSpliced(last + 1, 0, message) }
    })
  },
}