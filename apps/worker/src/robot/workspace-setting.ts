/**
 * A Robot's Workspace (v1.21, cw-gx04, cw-llvx; GLOSSARY: Workspace): a Host and a root directory there where the Robot works, kept by the
 * Robot DO with the repository root the Host found, and the Robot's current directory in it. Pure; the Robot DO keeps the values, the
 * Host checks the root before they are kept and checks every change of directory.
 */
import type { WorkDetails, WorkspaceChoice, WorkspacePlace, WorkspaceSetting } from '@mr-robot/protocol'

/** The Robot's keys: the setting, and its current directory there (the root until it moves). */
export const WORKSPACE = 'workspace'
export const WORKSPACE_CWD = 'workspace-cwd'
/** The Robot's own Work details (v1.21, cw-jy38); absent: the default. */
export const WORK_DETAILS = 'work-details'

/** The Work details a Robot shows when they do not follow the person's (cw-1h3q): its own, else Code with a Workspace. */
export const robotWorkDetails = (own: WorkDetails | undefined, setting: WorkspaceSetting | undefined): WorkDetails | undefined =>
  own ?? (setting === undefined ? undefined : 'code')

/** What the Workspace panel asked gets: a JSON value, or why there is none. */
export type WorkspacePanelAnswer = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string }

/** What the Host said of a root (the Stat RPC). */
export interface RootFacts {
  readonly path: string
  readonly kind: 'directory' | 'file' | 'missing' | 'other'
  readonly link: string | null
  readonly repository: string | null
}

/** A Workspace the owner chose, checked: the setting to keep, or why it is refused. */
export type CheckedWorkspace =
  | { readonly kind: 'kept'; readonly setting: WorkspaceSetting | null }
  | { readonly kind: 'refused'; readonly message: string }

/**
 * The setting from what the Host said of the chosen root: a directory, reached through no link (the sandbox would follow a link at a write
 * root), inside a git repository. The root is kept as the Host spelled it out (absolute).
 */
export function checkRoot(choice: WorkspaceChoice, hostName: string, facts: RootFacts): CheckedWorkspace {
  const where = `${facts.path} on ${hostName}`
  if (facts.kind === 'missing') return { kind: 'refused', message: `${where} does not exist.` }
  if (facts.kind !== 'directory') return { kind: 'refused', message: `${where} is not a directory.` }
  if (facts.link !== null) return { kind: 'refused', message: `${where} is reached through the link ${facts.link}; choose the directory the link points to.` }
  if (facts.repository === null) return { kind: 'refused', message: `${where} is not inside a git repository; run git init there first, or choose a directory inside a repository.` }
  return { kind: 'kept', setting: { hostId: choice.host, host: hostName, root: facts.path, repository: facts.repository } }
}

/** The Fleet's view of a setting (cw-hiwf). */
export const workspacePlace = (setting: WorkspaceSetting | undefined): WorkspacePlace | null =>
  setting === undefined ? null : { hostId: setting.hostId, host: setting.host, root: setting.root }

/** Whether two settings name one Workspace (the same Host and root): its session on the Host may stay open. */
export const sameWorkspace = (a: WorkspaceSetting | undefined, b: WorkspaceSetting | null | undefined): boolean =>
  a !== undefined && b !== null && b !== undefined && a.hostId === b.hostId && a.root === b.root
