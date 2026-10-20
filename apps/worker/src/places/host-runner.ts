/**
 * Jobs on a Host, for as long as the Host side keeps today's RPCs (v1.16 ticket 01): the Host runs one command in a fresh shell and
 * answers when it ends. A job here is such a call that the Robot does not wait for: the Robot keeps the pending call and its answer
 * in memory, so a job is lost when the Robot restarts (the registry then marks it lost and wakes the Robot as failed). A Host job
 * that DSH's jobs-local runs on the Host itself replaces this in ticket 03; the registry (jobs.ts) does not change.
 */
import type { RunOutcome } from '@mr-robot/host-protocol'
import type { BoxJobStatus } from '../box/backend.ts'
import type { JobRunner, RunExtras } from './jobs.ts'

/** The longest a command on a Host runs: the Host RPC stops it there. */
export const HOST_COMMAND_MAX_SECONDS = 600

/** What the Host answered for a command: DSH's foreground shape (ticket 02). */
export type HostCommandResult = RunOutcome

type Entry =
  | { state: 'running' }
  | { state: 'exited'; exitCode: number; result: HostCommandResult }
  | { state: 'gone'; result: HostCommandResult }
  /** The call did not run the command: the Host refused it, was offline or has no sandbox. The message says why. */
  | { state: 'refused'; message: string }

/** The pending calls of every Host of one Robot, by job id. */
export class HostRuns {
  readonly entries = new Map<string, Entry>()
}

/** What the Robot is told beside a result when the sandbox denied a write (ob-vnld): the path, and how to ask for the wider reach (ob-ifak). */
export function denialNote(host: string, result: HostCommandResult): string | undefined {
  const sandbox = result.sandbox
  if (sandbox?.denied !== true) return undefined
  const where = sandbox.deniedPath === undefined ? 'a file' : sandbox.deniedPath
  const reach = sandbox.mode === 'read-only' ? 'this grant is read-only, so nothing may be changed' : `this grant lets a command change your directory on ${host} and the write roots your owner listed`
  return `[sandbox: the write to ${where} was denied under ${sandbox.mode} mode: ${reach}.] If you need it, call run again with the same command, escalate: true and a reason: your owner is asked once, and when they approve the command runs without the sandbox, that one time. Otherwise change where the command writes.`
}

const cut = (name: string, output: { truncated: boolean }): string | undefined => (output.truncated ? `${name} is cut to its last part` : undefined)

/** The notes and sandbox facts a result carries to the Robot beside its output. */
function extrasOf(host: string, result: HostCommandResult): RunExtras {
  const note = [denialNote(host, result), result.sandbox?.enforcement === 'partial' ? `${host} enforces its sandbox only partly` : undefined, cut('stdout', result.stdout), cut('stderr', result.stderr)].filter((part) => part !== undefined).join('. ')
  return { cwd: result.cwd, ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }), ...(note === '' ? {} : { note }) }
}

export class HostRunner implements JobRunner {
  constructor(
    private readonly runs: HostRuns,
    private readonly host: string,
    /** One command on the Host, the call that returns when it ends; fails like every Host call. */
    private readonly command: (command: string, cwd: string | undefined, timeoutMs: number) => Promise<HostCommandResult>,
    /** Keeps the Robot up while the call is pending. */
    private readonly keepAlive: (pending: Promise<unknown>) => void,
  ) {}

  async spawn(job: string, command: string, cwd: string | undefined): Promise<void> {
    this.runs.entries.set(job, { state: 'running' })
    const pending = this.command(command, cwd, HOST_COMMAND_MAX_SECONDS * 1000).then(
      (result) => {
        if (this.runs.entries.get(job)?.state !== 'running') return
        // A command the Host stopped (its limit, a signal) left no exit code.
        this.runs.entries.set(job, result.exitCode === null ? { state: 'gone', result: { ...result, stderr: { ...result.stderr, text: `${result.stderr.text}${result.timedOut ? `\n[stopped after ${HOST_COMMAND_MAX_SECONDS} s]` : ''}` } } } : { state: 'exited', exitCode: result.exitCode, result })
      },
      (error: unknown) => {
        if (this.runs.entries.get(job)?.state !== 'running') return
        this.runs.entries.set(job, { state: 'refused', message: error instanceof Error ? error.message : String(error) })
      },
    )
    this.keepAlive(pending)
  }

  async status(job: string): Promise<BoxJobStatus> {
    const entry = this.runs.entries.get(job)
    if (entry === undefined || entry.state === 'gone' || entry.state === 'refused') return { state: 'gone' }
    return entry.state === 'running' ? { state: 'running' } : { state: 'exited', exitCode: entry.exitCode }
  }

  async output(job: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const entry = this.runs.entries.get(job)
    const text = entry === undefined || entry.state === 'running' ? '' : entry.state === 'refused' ? (stream === 'err' ? entry.message : '') : stream === 'out' ? entry.result.stdout.text : entry.result.stderr.text
    const bytes = new TextEncoder().encode(text)
    const piece = bytes.subarray(offset, offset + 262_144)
    return { text: new TextDecoder().decode(piece), bytes: piece.length, size: bytes.length }
  }

  /** The Host app cannot stop a command it is running for a call: the Robot lets go of it, and it ends at its own limit. */
  async kill(job: string): Promise<void> {
    if (this.runs.entries.get(job)?.state === 'running') this.runs.entries.set(job, { state: 'exited', exitCode: 143, result: { kind: 'foreground', cwd: '', exitCode: 143, signal: null, timedOut: false, aborted: true, timeoutMs: 0, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } } })
  }

  refusal(job: string): string | undefined {
    const entry = this.runs.entries.get(job)
    return entry?.state === 'refused' ? entry.message : undefined
  }

  extras(job: string): RunExtras | undefined {
    const entry = this.runs.entries.get(job)
    return entry?.state === 'exited' ? extrasOf(this.host, entry.result) : undefined
  }
}
