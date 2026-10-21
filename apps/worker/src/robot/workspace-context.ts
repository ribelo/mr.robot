/**
 * The Workspace's instructions as the Robot's context gets them (v1.21 ticket 04, cw-ec6f, cw-hm3d, cw-rkud): its own platform message
 * after the memory baseline. A session gets the whole chain (rendered on the Host by DSH's loader, with the nested files after it) when it
 * has none, when its current directory changed, and on a new chapter; then, at a Turn's start and after a read or write in the Workspace,
 * only what changed: a new or changed file with its content, a removed one with a notice. Pure; the Robot keeps the state.
 */
import { INSTRUCTIONS_MAX_BYTES, type HostSkillEntry, type WorkspaceContext } from '@mr-robot/host-protocol'

/** The Robot's keys: what the live session was given, and the Host's skill catalog it holds. */
export const WORKSPACE_CHAIN = 'workspace-chain'
export const WORKSPACE_SKILLS = 'workspace-skills'

/** What one session was given: the directory, the chain's digest and each file's digest. */
export interface ChainState {
  readonly sessionId: string
  readonly cwd: string
  readonly digest: string
  readonly files: Readonly<Record<string, string>>
}

/** The Host's skills the Robot holds, for one Workspace (hostId and root). */
export interface SkillsState {
  readonly workspace: string
  readonly digest: string
  readonly entries: readonly HostSkillEntry[]
}

/** A path as the Robot reads it: from the repository root when it is in it. */
const shown = (repository: string, path: string): string => (path.startsWith(`${repository}/`) ? path.slice(repository.length + 1) : path)

/** A text cut to a byte budget, with a line that says so. */
function within(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  const note = '\n\n[Cut to the budget of the Workspace instructions; read the files for the rest.]'
  return new TextDecoder().decode(bytes.subarray(0, maxBytes - note.length)).replace(/\uFFFD$/, '') + note
}

/** The whole chain for a session: DSH's rendered baseline, then the nested files, under one heading that names the place. */
export function baselineText(context: WorkspaceContext, where: { host: string; repository: string; cwd: string }): string {
  const nested = context.files.slice(context.files.length - context.nested).filter((file) => file.content !== null)
  const parts = [
    `Workspace instructions: the AGENTS.md chain of your Workspace on ${where.host} (repository ${where.repository}, current directory ${where.cwd}). They replace any earlier Workspace instructions.`,
    context.rendered ?? '',
    ...nested.map((file) => `Instructions from: ${shown(where.repository, file.path)}\n\n${file.content}`),
  ].filter((part) => part !== '')
  return within(parts.join('\n\n'), INSTRUCTIONS_MAX_BYTES)
}

/** What changed in the chain since a session's state: undefined when nothing did. */
export function changesText(before: ChainState, context: WorkspaceContext, repository: string): string | undefined {
  if (context.digest === before.digest) return undefined
  const now = new Set(context.files.map((file) => file.path))
  const lines: string[] = []
  for (const file of context.files) {
    if (file.content === null) continue
    lines.push(`Instructions from: ${shown(repository, file.path)} (${before.files[file.path] === undefined ? 'new' : 'changed; this replaces the earlier text'})\n\n${file.content}`)
  }
  for (const path of Object.keys(before.files)) {
    if (!now.has(path)) lines.push(`${shown(repository, path)} was removed: its instructions no longer apply.`)
  }
  if (lines.length === 0) return undefined
  return within(['Your Workspace instructions changed.', ...lines].join('\n\n'), INSTRUCTIONS_MAX_BYTES)
}

/** The state a session holds after a context. */
export const stateAfter = (sessionId: string, cwd: string, context: WorkspaceContext): ChainState =>
  ({ sessionId, cwd, digest: context.digest, files: Object.fromEntries(context.files.map((file) => [file.path, file.digest])) })
