/**
 * Jobs on a Host, for as long as the Host side keeps today's RPCs (v1.16 ticket 01): the Host runs one command in a fresh shell and
 * answers when it ends. A job here is such a call that the Robot does not wait for: the Robot keeps the pending call and its answer
 * in memory, so a job is lost when the Robot restarts (the registry then marks it lost and wakes the Robot as failed). A Host job
 * that DSH's jobs-local runs on the Host itself replaces this in ticket 03; the registry (jobs.ts) does not change.
 */
import type { BoxJobStatus } from '../box/backend.ts'
import type { JobRunner } from './jobs.ts'

/** The longest a command on a Host runs: the Host RPC stops it there. */
export const HOST_COMMAND_MAX_SECONDS = 600

export interface HostCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
}

type Entry =
  | { state: 'running' }
  | { state: 'exited'; exitCode: number; stdout: string; stderr: string }
  | { state: 'gone'; stdout: string; stderr: string }

/** The pending calls of every Host of one Robot, by job id. */
export class HostRuns {
  readonly entries = new Map<string, Entry>()
}

export class HostRunner implements JobRunner {
  constructor(
    private readonly runs: HostRuns,
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
        this.runs.entries.set(job, result.exitCode === null ? { state: 'gone', stdout: result.stdout, stderr: `${result.stderr}${result.timedOut ? `\n[stopped after ${HOST_COMMAND_MAX_SECONDS} s]` : ''}` } : { state: 'exited', exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })
      },
      (error: unknown) => {
        if (this.runs.entries.get(job)?.state !== 'running') return
        this.runs.entries.set(job, { state: 'gone', stdout: '', stderr: error instanceof Error ? error.message : String(error) })
      },
    )
    this.keepAlive(pending)
  }

  async status(job: string): Promise<BoxJobStatus> {
    const entry = this.runs.entries.get(job)
    if (entry === undefined || entry.state === 'gone') return { state: 'gone' }
    return entry.state === 'running' ? { state: 'running' } : { state: 'exited', exitCode: entry.exitCode }
  }

  async output(job: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const entry = this.runs.entries.get(job)
    const text = entry === undefined || entry.state === 'running' ? '' : stream === 'out' ? entry.stdout : entry.stderr
    const bytes = new TextEncoder().encode(text)
    const piece = bytes.subarray(offset, offset + 262_144)
    return { text: new TextDecoder().decode(piece), bytes: piece.length, size: bytes.length }
  }

  /** The Host app cannot stop a command it is running for a call: the Robot lets go of it, and it ends at its own limit. */
  async kill(job: string): Promise<void> {
    if (this.runs.entries.get(job)?.state === 'running') this.runs.entries.set(job, { state: 'exited', exitCode: 143, stdout: '', stderr: '' })
  }
}
