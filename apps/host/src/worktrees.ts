/**
 * Worktrees in a Workspace (v1.21 ticket 05, cw-11je): DSH's worktree runtime (@deepseek-ai/dsh-experimental-worktree) creates a branch
 * and a checkout under <repository>/.agents/worktrees/<name> from the current commit, with configured Git filters off and nothing fetched.
 * It binds to a DSH Agent only to read and set the Session's directory and its file policy; here the carrier is the app's own: the
 * "agent" is the Robot's current directory and the policy of a platform act (unconfined, as the spec says: the app creates the checkout,
 * and the Robot's own writes are confined to it afterwards by its write roots). The Worker keeps the new directory.
 */
import { realpath } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import Worktrees, { type CreatedWorktree } from '@deepseek-ai/dsh-experimental-worktree'

/** What the app hands DSH's runtime for an Agent: where the Robot is, and the policy of the act. */
export interface WorktreeCaller {
  readonly cwd: string
  readonly session: { readonly id: string; readonly platformPolicy: SandboxExecutionPolicy }
}

/** The working-directory service DSH's runtime looks up: the caller's directory, and the canonical form of the one it enters. */
class CallerDirectory extends Service {
  constructor(ctx: Context) {
    // SAFETY: Cordis types service names as a closed union that DSH's packages extend; this registers the one the runtime injects.
    super(ctx, 'workingDirectory' as never)
  }
  async ensure(agent: WorktreeCaller): Promise<string> {
    return agent.cwd
  }
  async set(_agent: WorktreeCaller, path: string): Promise<string> {
    return realpath(path)
  }
}

/** Mount the runtime on the app's DSH context (it has subprocess, sandbox and the policy service already). */
export async function mountWorktrees(ctx: Context, home: string, gitCommand: string): Promise<void> {
  await ctx.plugin(FsLocal, { cwd: home })
  await ctx.plugin(CallerDirectory)
  // Node is the app's own program (Electron runs it as Node for DSH's runners, run-as-node.ts).
  await ctx.plugin(Worktrees, { gitCommand, nodeCommand: process.execPath })
}

/** Create the Robot's worktree named `name` from its current directory's checkout. */
export function createWorktree(ctx: Context, input: { readonly cwd: string; readonly repository: string; readonly name: string }): Promise<CreatedWorktree> {
  const caller: WorktreeCaller = { cwd: input.cwd, session: { id: `worktree:${input.name}`, platformPolicy: { mode: 'danger-full-access', workspaceRoot: input.repository } } }
  // SAFETY: the runtime reads only `agent.session` (for the policy) and passes the agent to the working-directory service above.
  return ctx.worktrees.create(caller as never, { name: input.name })
}
