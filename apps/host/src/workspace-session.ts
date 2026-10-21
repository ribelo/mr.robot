/**
 * The Workspace sessions of this app (v1.21, cw-p4bm): one per Robot whose Workspace is on this computer, holding what the app keeps
 * for that Workspace between calls (later tickets add the instruction chain's digests, the skill catalog and the language servers, each
 * registered with onClose). A session opens on the first call that carries the Robot's Workspace and closes when the Workspace changes (a
 * call carries another one, or the Worker says WorkspaceClose: the setting changed or the Robot was deleted), when this computer is
 * unpaired and when the app quits. Closing runs what was registered, newest first; a failure there is logged and the rest still runs.
 */
import type { WorkspaceAccess } from '@mr-robot/host-protocol'

export class WorkspaceSession {
  private readonly closers: Array<() => Promise<void> | void> = []
  private closed = false
  /** The directories a read or a write of the Robot touched in the repository (cw-hm3d): their instruction files join the chain. */
  readonly touched = new Set<string>()

  constructor(
    /** The Robot's directory name, which keys the sessions (HostAccess.robot). */
    readonly robot: string,
    readonly workspace: WorkspaceAccess,
  ) {}

  /** Run `close` when the session closes; at once when it is closed already. */
  onClose(close: () => Promise<void> | void): void {
    if (this.closed) {
      void Promise.resolve().then(close).catch((error: unknown) => console.warn('mr-robot-host: a Workspace session part did not close', error))
      return
    }
    this.closers.push(close)
  }

  get isOpen(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const close of this.closers.splice(0).reverse()) {
      try {
        await close()
      } catch (error) {
        console.warn('mr-robot-host: a Workspace session part did not close', error)
      }
    }
  }
}

const sameWorkspace = (a: WorkspaceAccess, b: WorkspaceAccess): boolean => a.root === b.root && a.repository === b.repository && a.worktree === b.worktree

export class WorkspaceSessions {
  private readonly sessions = new Map<string, WorkspaceSession>()

  /**
   * The session of a call: opened when the Robot has none, and opened anew when its Workspace changed (the old one closes first). A call
   * without a Workspace (a Robot whose Workspace is elsewhere, or none) neither opens nor closes one.
   */
  async touch(robot: string, workspace: WorkspaceAccess | undefined): Promise<WorkspaceSession | undefined> {
    if (workspace === undefined) return undefined
    const open = this.sessions.get(robot)
    if (open !== undefined && sameWorkspace(open.workspace, workspace)) return open
    // The new session takes the place first, so that a call arriving meanwhile finds it, not the one that is closing.
    const session = new WorkspaceSession(robot, workspace)
    this.sessions.set(robot, session)
    await open?.close()
    return session
  }

  /** The open session of a Robot, if any. */
  get(robot: string): WorkspaceSession | undefined {
    return this.sessions.get(robot)
  }

  /** The Robots with an open session. */
  robots(): string[] {
    return [...this.sessions.keys()]
  }

  async close(robot: string): Promise<void> {
    const session = this.sessions.get(robot)
    this.sessions.delete(robot)
    await session?.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.robots().map((robot) => this.close(robot)))
  }
}
