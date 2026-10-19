/**
 * Oversized tool results spill to the Workspace (v1.14, ao-hf02): DSH's spill policy keeps the head and
 * the tail inline and stores the complete result through this store under spill/ in the Robot's
 * Workspace, where the file tools read it. Spill files are tidied after 30 days (ao-ry61).
 */
import { type Context } from '@deepseek-ai/cordis'
import SpillStore, { SpillLocator, type SaveTextSpill, type SpillRef } from '@deepseek-ai/dsh-spill'
import * as Effect from 'effect/Effect'
import { WORKSPACE_ROOT } from './r2-filesystem.ts'
import { workspacePrefix, type WorkspaceShape } from './workspace.ts'

export const SPILL_DIRECTORY = 'spill'
export const SPILL_KEEP_MS = 30 * 24 * 60 * 60 * 1000
export const SPILL_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000

/** The inline budget follows the context budget (ao-antj): a sixteenth of it, between 2 000 and 12 500 tokens. */
export function maxInlineTokens(contextBudget: number): number {
  return Math.min(12_500, Math.max(2_000, Math.floor(contextBudget / 16)))
}

export interface WorkspaceSpillConfig {
  readonly workspace: WorkspaceShape
  /** Whether the Robot has the file tools that read a spill file (read, grep). */
  readonly fileTools: boolean
}

const READ_HINT = 'Use read with offset/limit, or grep this path to search within it.'
const NO_TOOLS_HINT = 'You have no file tools to read it; your owner can open it in Files.'

/** One path segment: letters, digits, dot, dash and underscore. */
function segment(text: string): string {
  const safe = text.replaceAll(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return safe === '' ? 'result.txt' : safe.slice(0, 80)
}

export class WorkspaceSpillStore extends SpillStore {
  private readonly workspace: WorkspaceShape
  private readonly hint: string

  constructor(ctx: Context, config: WorkspaceSpillConfig) {
    super(ctx)
    this.workspace = config.workspace
    this.hint = config.fileTools ? READ_HINT : NO_TOOLS_HINT
  }

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const id = input.source.kind === 'tool' ? String(input.source.callId) : crypto.randomUUID()
    const path = `${SPILL_DIRECTORY}/${segment(String(input.owner.sessionId))}/${segment(id)}-${segment(input.suggestedName)}`
    const bytes = new TextEncoder().encode(input.content).byteLength
    await Effect.runPromise(this.workspace.write(path, input.content, 'text/plain; charset=utf-8'))
    return { locator: SpillLocator(`${WORKSPACE_ROOT}/${path}`), bytes, retrievalHint: this.hint }
  }
}

/** Delete the spill files older than 30 days; returns how many are left. */
export async function sweepSpill(bucket: R2Bucket, robotId: string, now: number): Promise<number> {
  const prefix = `${workspacePrefix(robotId)}${SPILL_DIRECTORY}/`
  let left = 0
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) })
    const old = page.objects.filter((object) => now - object.uploaded.getTime() > SPILL_KEEP_MS).map((object) => object.key)
    if (old.length > 0) await bucket.delete(old)
    left += page.objects.length - old.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return left
}
