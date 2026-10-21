/**
 * Language servers for the Workspaces on this computer (v1.21 ticket 06, cw-lx4f, cw-fb1q, cw-yeq1). DSH's lsp seam and its stdio
 * provider (@deepseek-ai/dsh-lsp, dsh-lsp-stdio) answer the four queries; DSH ships no servers and no configuration, so the app does:
 * lsp.yaml in its config directory holds DSH's `servers` record, and without the file the default set below is used. An entry whose
 * command is not on the OS user's login PATH is left out, so one missing server never disables the others (DSH refuses the whole record
 * when one command does not resolve). A Robot's servers start on its first query, with the Workspace's root (its worktree when it has
 * one) as the workspace root, and stop when its Workspace session closes or after LSP_IDLE_MS without a query. Servers run unconfined,
 * as DSH runs them: a repository's own server binary is trusted as the OS user.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as LspStdio from '@deepseek-ai/dsh-lsp-stdio'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { parse } from 'yaml'
import { startRunnersAsNode } from './run-as-node.ts'
import type { WorkspaceSession } from './workspace-session.ts'

/** One server as DSH's lsp-stdio takes it (the fields the app passes on; the rest are DSH's defaults). */
export interface LspServer {
  readonly command: string
  readonly args?: readonly string[]
  readonly extensionToLanguage: Readonly<Record<string, string>>
  readonly env?: Readonly<Record<string, string>>
  readonly initializationOptions?: unknown
  readonly configuration?: unknown
}

/** The servers the app knows without lsp.yaml (cw-fb1q). */
export const DEFAULT_SERVERS: Readonly<Record<string, LspServer>> = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript', '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript' } },
  python: { command: 'pyright-langserver', args: ['--stdio'], extensionToLanguage: { '.py': 'python', '.pyi': 'python' } },
  rust: { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
  go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } },
  ocaml: { command: 'ocamllsp', extensionToLanguage: { '.ml': 'ocaml', '.mli': 'ocaml' } },
  nix: { command: 'nil', extensionToLanguage: { '.nix': 'nix' } },
}

/** How long a Robot's servers live without a query (cw-yeq1). */
export const LSP_IDLE_MS = 30 * 60_000

/** The servers lsp.yaml names in the config directory, else the default set; a file that is not a servers record is the default too. */
export function configuredServers(configDirectory: string | undefined): Record<string, LspServer> {
  if (configDirectory === undefined) return { ...DEFAULT_SERVERS }
  let text: string
  try {
    text = readFileSync(join(configDirectory, 'lsp.yaml'), 'utf8')
  } catch {
    return { ...DEFAULT_SERVERS }
  }
  const value = parse(text) as { servers?: unknown } | null
  const servers = value?.servers
  if (typeof servers !== 'object' || servers === null) {
    console.warn('mr-robot-host: lsp.yaml has no servers record; the default set is used')
    return { ...DEFAULT_SERVERS }
  }
  return Object.fromEntries(Object.entries(servers as Record<string, LspServer>).filter(([, server]) => typeof server?.command === 'string' && typeof server.extensionToLanguage === 'object'))
}

/**
 * The servers that can run here (cw-fb1q): each command found on the login PATH (an absolute one as it is), as an absolute path, with
 * that PATH in its environment so a server's own shebang finds its interpreter.
 */
export function mountableServers(servers: Readonly<Record<string, LspServer>>, onPath: (command: string) => string | undefined, path: string | undefined): Record<string, LspServer> {
  const mounted: Record<string, LspServer> = {}
  for (const [id, server] of Object.entries(servers)) {
    const command = onPath(server.command)
    if (command === undefined) continue
    mounted[id] = { ...server, command, env: { ...(path === undefined ? {} : { PATH: path }), ...server.env } }
  }
  return mounted
}

interface Running {
  readonly ctx: Context
  readonly root: string
  lastQuery: number
}

/** The language servers of the Workspace sessions on this computer: one DSH lsp context per session, started on its first query. */
export class HostLanguageServers {
  private readonly running = new Map<WorkspaceSession, Running>()
  private readonly sweep: ReturnType<typeof setInterval>

  constructor(
    private readonly servers: () => Readonly<Record<string, LspServer>>,
    private readonly home: string,
    private readonly idleMs = LSP_IDLE_MS,
    private readonly now = () => Date.now(),
  ) {
    this.sweep = setInterval(() => { void this.stopIdle() }, Math.min(60_000, Math.max(50, Math.floor(idleMs / 4))))
    this.sweep.unref?.()
  }

  /** One query (cw-lx4f): positions are DSH's, zero-based UTF-16. */
  async query(session: WorkspaceSession, root: string, request: { operation: 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'; file: string; line: number; character: number }, signal?: AbortSignal) {
    const entry = await this.start(session, root)
    entry.lastQuery = this.now()
    return entry.ctx.lsp.query({ operation: request.operation, filePath: request.file, position: { line: request.line, character: request.character }, workspaceRoot: root }, signal)
  }

  /** The sessions whose servers run now. */
  sessions(): WorkspaceSession[] {
    return [...this.running.keys()]
  }

  private async start(session: WorkspaceSession, root: string): Promise<Running> {
    const known = this.running.get(session)
    if (known !== undefined && known.root === root) return known
    if (known !== undefined) await this.stop(session)
    const servers = this.servers()
    if (Object.keys(servers).length === 0) throw Object.assign(new Error('No language server is installed on this computer: install one (typescript-language-server, pyright, rust-analyzer, gopls, ocamllsp, nil) or name one in lsp.yaml.'), { code: 'LSP_UNAVAILABLE' })
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    startRunnersAsNode(ctx.subprocess)
    await ctx.plugin(FsLocal, { cwd: this.home })
    await ctx.plugin(Lsp)
    await ctx.plugin(LspStdio, { servers } as never)
    const entry: Running = { ctx, root, lastQuery: this.now() }
    this.running.set(session, entry)
    session.onClose(() => this.stop(session))
    return entry
  }

  /** Stop a session's servers: DSH's disposal shuts each one down gracefully. */
  async stop(session: WorkspaceSession): Promise<void> {
    const entry = this.running.get(session)
    if (entry === undefined) return
    this.running.delete(session)
    await entry.ctx.fiber.dispose()
  }

  private async stopIdle(): Promise<void> {
    const now = this.now()
    for (const [session, entry] of [...this.running]) {
      if (now - entry.lastQuery >= this.idleMs) await this.stop(session)
    }
  }

  async dispose(): Promise<void> {
    clearInterval(this.sweep)
    await Promise.all(this.sessions().map((session) => this.stop(session)))
  }
}
