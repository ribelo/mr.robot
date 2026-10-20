/**
 * Commands on this computer, through DSH (v1.16 ticket 02, ob-wsf7): bash and DSH's sandbox-local (bwrap or Landlock on Linux,
 * Seatbelt on macOS). The Host app composes only the layer under DSH's tools (subprocess, sandbox, shell), in a context of its own; the
 * tools themselves belong to an agent and are not used. One seam picks the shell (a later ticket puts pwsh on Windows behind it).
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import Bash from '@deepseek-ai/dsh-bash-sandbox'
import { SANDBOX_UNAVAILABLE as DSH_SANDBOX_UNAVAILABLE, type SandboxExecutionPolicy, type SandboxMode, type SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import Sandbox, { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { SANDBOX_UNAVAILABLE, type HostAccess, type HostMode, type Sandbox as SandboxState, type SandboxReport, type ShellName } from '@mr-robot/host-protocol'
import { ensureRobotDirectory, expandPath, writeRoots } from './access.ts'

/** The most a command runs, and how long it runs when the call names no time (as v1.2 ran them). */
const MAX_TIMEOUT_MS = 600_000
const DEFAULT_TIMEOUT_MS = 120_000

/** DSH's word for each of ours. */
const SANDBOX_MODE: Readonly<Record<HostMode, SandboxMode>> = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', full: 'danger-full-access' }
const HOST_MODE: Readonly<Record<SandboxMode, HostMode>> = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', 'danger-full-access': 'full' }

/** A policy that also carries the extra write roots of a grant. */
type RootedPolicy = SandboxPolicy & { readonly extraRoots?: readonly string[] }

/**
 * DSH's sandbox-local confines one write root. A grant has several, so this provider adds the others to the argv of the runner it
 * selected: bwrap binds them, Landlock grants them read-write. A runner that cannot take them (Seatbelt, the Windows token) fails the
 * call closed instead of running it with fewer roots than the grant names.
 */
class ManyRootsSandbox extends LocalSandboxProvider {
  override async confine(argv: readonly string[], policy: RootedPolicy, signal?: AbortSignal) {
    const confined = await super.confine(argv, policy, signal)
    const extra = policy.mode === 'workspace-write' ? (policy.extraRoots ?? []) : []
    if (extra.length === 0) return confined
    const runner = confined.argv[0] ?? ''
    const grants = runner.endsWith('bwrap') ? extra.flatMap((root) => ['--bind', root, root]) : runner.endsWith('landlock-run') ? extra.flatMap((root) => ['--rw', root]) : undefined
    if (grants === undefined) throw Object.assign(new Error('This computer\'s sandbox confines one directory, so a grant with more write roots cannot run commands here. Give the grant no extra roots, or full access.'), { code: DSH_SANDBOX_UNAVAILABLE })
    const separator = confined.argv.indexOf('--')
    return { ...confined, argv: [...confined.argv.slice(0, separator), ...grants, ...confined.argv.slice(separator)] }
  }
}

/** bash-sandbox needs a policy service; every call here brings its own policy, so this one only has to exist. */
class PolicyService extends Service {
  readonly defaultMode: SandboxMode = 'read-only'
  readonly workspaceRoot = homedir()
  constructor(ctx: Context) {
    super(ctx, 'sandboxPolicy' as never)
  }
  resolve(): SandboxExecutionPolicy {
    return { mode: this.defaultMode, workspaceRoot: this.workspaceRoot }
  }
}

/** The PATH the OS user's login shell would give (a desktop-launched app has a short one); undefined when it cannot be asked. */
function loginPath(): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  return new Promise((done) => {
    execFile(process.env['SHELL'] || '/bin/sh', ['-lc', 'printf %s "$PATH"'], { timeout: 5000 }, (error, stdout) => done(error === null && stdout.trim() !== '' ? stdout.trim() : undefined))
  })
}

/** The path of the denied file effect, from the error output of the command (the bash and coreutils dialects). */
export function deniedPath(stderr: string): string | undefined {
  for (const line of stderr.split('\n')) {
    const found = /^(.*): (?:Read-only file system|Permission denied|Operation not permitted|Access is denied)\.?$/i.exec(line.trim())
    if (found === null) continue
    const quoted = [...found[1]!.matchAll(/'([^']+)'/g)].at(-1)?.[1]
    if (quoted !== undefined) return quoted
    const path = found[1]!.split(': ').at(-1)!.trim()
    if (path !== '') return path
  }
  return undefined
}

const denial = (stderr: string, cwd: string): { deniedPath?: string } => {
  const path = deniedPath(stderr)
  return path === undefined ? {} : { deniedPath: resolve(cwd, path) }
}

export interface RunInput {
  readonly command: string
  readonly cwd?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly access: HostAccess
}

/** DSH's foreground shape, which the Run RPC answers with. */
export type ShellResult = {
  readonly kind: 'foreground'
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly timeoutMs: number
  readonly stdout: ShellRunResult['stdout']
  readonly stderr: ShellRunResult['stderr']
  readonly sandbox?: SandboxReport
}

export class HostShell {
  private constructor(
    private readonly ctx: Context,
    private readonly home: string,
    private readonly path: string | undefined,
    /** How completely this computer confines a command, found when the app started. */
    readonly sandbox: SandboxState,
    /** The shell a Robot's command runs in here (ob-vyyg): bash; pwsh on Windows is the one place that changes it. */
    readonly shell: ShellName,
  ) {}

  /** Compose DSH's layer and find out what the sandbox can do here (the heartbeat reports it, ob-n72n). */
  static async start(options: { readonly home?: string; readonly landlockLauncher?: string } = {}): Promise<HostShell> {
    const home = options.home ?? homedir()
    const ctx = new Context()
    await ctx.plugin(Subprocess)
    await ctx.plugin(ManyRootsSandbox)
    await ctx.plugin(PolicyService)
    await ctx.plugin(Bash, {})
    // A bundled app carries the Landlock launcher beside itself; DSH looks for it in node_modules.
    const launcher = options.landlockLauncher
    if (launcher !== undefined && existsSync(launcher)) (ctx.sandbox as LocalSandboxProvider).internals.landlockLauncher = launcher
    const probeRoot = join(home, 'mr-robot')
    await mkdir(probeRoot, { recursive: true })
    const sandbox: SandboxState = await ctx.sandbox.confine(['true'], { mode: 'read-only', workspaceRoot: probeRoot }).then(
      (confined) => confined.enforcement,
      () => 'none' as const,
    )
    return new HostShell(ctx, home, await loginPath(), sandbox, 'bash')
  }

  /** One command in the Robot's directory (or the cwd it names), under the mode and roots of its grant. */
  async run(input: RunInput): Promise<ShellResult> {
    const directory = await ensureRobotDirectory(this.home, input.access)
    const cwd = input.cwd === undefined ? directory : expandPath(this.home, directory, input.cwd)
    if (!(await stat(cwd).then((info) => info.isDirectory(), () => false))) throw Object.assign(new Error(`${cwd} is not a directory on this computer`), { code: 'ENOENT' })
    const extraRoots = writeRoots(this.home, input.access).slice(1)
    const policy: SandboxExecutionPolicy & { extraRoots?: readonly string[] } = { mode: SANDBOX_MODE[input.access.mode], workspaceRoot: directory, ...(extraRoots.length === 0 ? {} : { extraRoots }) }
    let result: ShellRunResult
    try {
      const spec = this.ctx.shell.resolve({
        command: input.command,
        workdir: cwd,
        timeoutMs: Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        sandboxPolicy: policy,
        ...(this.path === undefined ? {} : { env: { PATH: this.path } }),
      })
      result = await (await this.ctx.shell.execute(spec)).result()
    } catch (error) {
      // A confined call on a computer with no usable sandbox fails closed, with the reason.
      if ((error as { code?: unknown }).code === DSH_SANDBOX_UNAVAILABLE) throw Object.assign(new Error(`This computer has no usable sandbox (Linux needs bubblewrap or a kernel with Landlock, macOS needs sandbox-exec), so a command in ${input.access.mode} mode does not run. Only a grant in full mode runs here.`), { code: SANDBOX_UNAVAILABLE })
      throw error
    }
    const sandbox = result.sandbox
    return {
      kind: 'foreground',
      cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      aborted: result.aborted,
      timeoutMs: result.timeoutMs,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(sandbox === undefined ? {} : { sandbox: { mode: HOST_MODE[sandbox.mode], denied: sandbox.denied, ...(sandbox.denied ? denial(result.stderr.text, cwd) : {}), ...(sandbox.enforcement === undefined ? {} : { enforcement: sandbox.enforcement }) } }),
    }
  }

  async dispose(): Promise<void> {
    await this.ctx.fiber.dispose()
  }
}
