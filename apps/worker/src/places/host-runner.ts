/**
 * Jobs on a Host (v1.16 ticket 03, ob-sja4): the Host app runs every command as a job of DSH's jobs-local registry and holds the job as long
 * as the app runs. This runner is the Robot's side of it. A foreground command is one Run call that waits at the Host up to the limit and
 * answers with the result, or with "promoted" when the command goes on; a job started at once answers "background". After that the Robot
 * asks the Host for the job's state and output (JobList, JobOutput), and the registry (jobs.ts) does what it does for the Box.
 *
 * What the Robot keeps in memory is only the pending Run call and its answer. When the Robot restarts the memory is gone, and the
 * runner asks the Host instead; a job the Host does not know is gone (the app restarted).
 */
import type { JobInfo, RunOutcome } from '@mr-robot/host-protocol'
import type { BoxJobStatus } from '../box/backend.ts'
import type { JobId } from './job-id.ts'
import type { JobRunner, RunExtras, SpawnOptions } from './jobs.ts'

type Foreground = Extract<RunOutcome, { kind: 'foreground' }>

/** The Host's job calls for one Robot on one Host, each failing as a Host call fails (offline, refused, an OS error). */
export interface HostJobLink {
  /** Run: start the command as a job, wait for it up to `timeoutMs` (not at all for a background job). */
  start(input: { job: JobId; command: string; cwd: string | undefined; timeoutMs: number; background: boolean }): Promise<RunOutcome>
  list(): Promise<readonly JobInfo[]>
  output(job: JobId, stream: 'out' | 'err', offset: number): Promise<{ readonly text: string; readonly bytes: number; readonly size: number }>
  kill(job: JobId): Promise<void>
}

/**
 * What the Robot holds of a Run call it made. Once the Host holds the job itself (promoted, or started in the background) there is nothing
 * to keep: the Host is asked. An entry goes when the registry closes its job (release), so the map holds only calls in flight and answers
 * not yet read.
 */
type Entry =
  /** The Run call is pending. */
  | { state: 'running' }
  /** The command ended within its call. */
  | { state: 'done'; result: Foreground }
  /** The call did not run the command: the Host refused it, was offline or has no sandbox. The message says why. */
  | { state: 'refused'; message: string }

/** The pending calls of every Host of one Robot, by job id. */
export class HostRuns {
  readonly entries = new Map<JobId, Entry>()
}

/** What the Robot is told beside a result when the sandbox denied a write (ob-vnld): the path, and how to ask for the wider reach (ob-ifak). */
export function denialNote(host: string, result: Foreground): string | undefined {
  const sandbox = result.sandbox
  if (sandbox?.denied !== true) return undefined
  const where = sandbox.deniedPath === undefined ? 'a file' : sandbox.deniedPath
  const reach = sandbox.mode === 'read-only' ? 'this grant is read-only, so nothing may be changed' : `this grant lets a command change your directory on ${host} and the write roots your owner listed`
  return `[sandbox: the write to ${where} was denied under ${sandbox.mode} mode: ${reach}.] If you need it, call run again with the same command, escalate: true and a reason: your owner is asked once, and when they approve the command runs without the sandbox, that one time. Otherwise change where the command writes.`
}

const truncationNote = (name: string, output: { truncated: boolean }): string | undefined => (output.truncated ? `${name} is cut to its last part` : undefined)

/** The notes and sandbox facts a result carries to the Robot beside its output. */
function extrasOf(host: string, result: Foreground): RunExtras {
  const note = [denialNote(host, result), result.sandbox?.enforcement === 'partial' ? `${host} enforces its sandbox only partly` : undefined, truncationNote('stdout', result.stdout), truncationNote('stderr', result.stderr)].filter((part) => part !== undefined).join('. ')
  return { cwd: result.cwd, ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }), ...(note === '' ? {} : { note }) }
}

export class HostRunner implements JobRunner {
  constructor(
    private readonly runs: HostRuns,
    private readonly host: string,
    private readonly link: HostJobLink,
    /** Keeps the Robot up while the call is pending. */
    private readonly keepAlive: (pending: Promise<unknown>) => void,
  ) {}

  async spawn(job: JobId, command: string, cwd: string | undefined, options: SpawnOptions): Promise<void> {
    this.runs.entries.set(job, { state: 'running' })
    const call = this.link.start({ job, command, cwd, timeoutMs: options.seconds * 1000, background: options.background })
    if (options.background) {
      // A job started at once is answered at once, so a refusal is the Robot's to hear now.
      try {
        this.answer(job, await call)
      } catch (error) {
        this.runs.entries.delete(job)
        throw error
      }
      return
    }
    this.keepAlive(call.then(
      (outcome) => this.answer(job, outcome),
      (error: unknown) => {
        if (this.runs.entries.get(job)?.state === 'running') this.runs.entries.set(job, { state: 'refused', message: error instanceof Error ? error.message : String(error) })
      },
    ))
  }

  private answer(job: JobId, outcome: RunOutcome): void {
    if (this.runs.entries.get(job)?.state !== 'running') return
    if (outcome.kind === 'foreground') this.runs.entries.set(job, { state: 'done', result: outcome })
    else this.runs.entries.delete(job)
  }

  release(job: JobId): void {
    this.runs.entries.delete(job)
  }

  async status(job: JobId): Promise<BoxJobStatus> {
    const entry = this.runs.entries.get(job)
    if (entry?.state === 'running') return { state: 'running' }
    if (entry?.state === 'refused') return { state: 'gone' }
    // A command the Host stopped (a signal) left no exit code.
    if (entry?.state === 'done') return entry.result.exitCode === null ? { state: 'gone' } : { state: 'exited', exitCode: entry.result.exitCode }
    // The Host holds the job (or the Robot restarted and forgot the call): ask it. A Host that is away is not an answer, and the job goes
    // on; a Host the Robot has no access to any more (shared no more, unpaired, the grant lowered) never will be, so its job is lost.
    const listed = await this.link.list().then((jobs) => jobs.find((candidate) => candidate.job === job), (error: unknown) => (error instanceof Error && error.name === 'HostAccessLost' ? 'lost' as const : 'away' as const))
    if (listed === 'lost') return { state: 'gone' }
    if (listed === 'away' || listed?.state === 'running') return { state: 'running' }
    if (listed === undefined || listed.exitCode === null) return { state: 'gone' }
    return { state: 'exited', exitCode: listed.exitCode }
  }

  async output(job: JobId, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const entry = this.runs.entries.get(job)
    if (entry?.state === 'refused' || entry?.state === 'done') {
      const text = entry.state === 'refused' ? (stream === 'err' ? entry.message : '') : stream === 'out' ? entry.result.stdout.text : entry.result.stderr.text
      const bytes = new TextEncoder().encode(text)
      const piece = bytes.subarray(offset, offset + 262_144)
      return { text: new TextDecoder().decode(piece), bytes: piece.length, size: bytes.length }
    }
    return this.link.output(job, stream, offset)
  }

  async kill(job: JobId): Promise<void> {
    const entry = this.runs.entries.get(job)
    if (entry?.state === 'refused' || entry?.state === 'done') return
    await this.link.kill(job)
  }

  refusal(job: JobId): string | undefined {
    const entry = this.runs.entries.get(job)
    return entry?.state === 'refused' ? entry.message : undefined
  }

  extras(job: JobId): RunExtras | undefined {
    const entry = this.runs.entries.get(job)
    return entry?.state === 'done' ? extrasOf(this.host, entry.result) : undefined
  }
}
