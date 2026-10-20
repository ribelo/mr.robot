/**
 * Jobs on this computer (v1.16 ticket 03, ob-sja4): every command a Robot runs is a job of DSH's jobs-local registry. The call waits
 * for it up to its limit; a command that is still running then goes on as a job, and the call can also start one at once. A command whose
 * call goes away (the connection to the Worker dropped) goes on as a job too, and a command that ended within its call stays among the
 * ended jobs, so a Worker that lost the answer finds the result by asking (deep review P11). The registry holds the jobs in this
 * process's memory, so they live as long as the app does and no longer: the heartbeat's `instance` tells the Worker when the app has
 * restarted.
 *
 * Nothing here knows which shell started a process. A caller hands over a process it has spawned (a ShellExecution) with the name the
 * Worker gave the job; a later ticket's PowerShell passes its processes the same way.
 */
import { open } from 'node:fs/promises'
import * as Data from 'effect/Data'
import type { Context } from '@deepseek-ai/cordis'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type { ShellExecution } from '@deepseek-ai/dsh-shell'
import { NO_SUCH_JOB, type JobEnded, type JobInfo, type JobState } from '@mr-robot/host-protocol'

/**
 * The ended jobs the app keeps for the Worker to read, the newest ones, those that ended within their call included; older ones are
 * dropped when a new job starts.
 */
const KEEP_ENDED = 50
/** The most one JobOutput answer carries. */
const PIECE_BYTES = 256 * 1024
/** DSH's job registry has one kind for shell commands, "bash"; a PowerShell command is filed under it too, and nothing reads the kind. */
const SHELL_JOB_KIND = 'bash'

interface Entry {
  readonly ref: string
  readonly id: JobId
  readonly command: string
  readonly startedAt: number
  readonly process: ShellExecution
  finishedAt: number | null
}

/** A job call that names a job this app does not hold. */
export class NoSuchJob extends Data.TaggedError('NoSuchJob')<{ readonly message: string }> {
  readonly code = NO_SUCH_JOB
  constructor(ref: string) {
    super({ message: `this computer has no job ${ref}: it never ran here, or the app restarted since` })
  }
}

/** How many bytes of `buffer[0..length)` end on a whole UTF-8 character: a piece must not cut one in half. */
export function wholeCharacters(buffer: Uint8Array, length: number): number {
  for (let back = 1; back <= 3 && back <= length; back++) {
    const byte = buffer[length - back] ?? 0
    if ((byte & 0xc0) === 0x80) continue
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return need > back ? length - back : length
  }
  return length
}

/** A slice of the file that holds a stream whose head the app no longer keeps in memory. */
async function readSpill(path: string, offset: number, total: number): Promise<{ text: string; bytes: number; size: number }> {
  const handle = await open(path, 'r')
  try {
    const wanted = Math.max(0, Math.min(PIECE_BYTES, total - offset))
    const buffer = Buffer.alloc(wanted)
    const { bytesRead } = await handle.read(buffer, 0, wanted, offset)
    const bytes = offset + bytesRead >= total ? bytesRead : wholeCharacters(buffer, bytesRead)
    return { text: buffer.subarray(0, bytes).toString('utf8'), bytes, size: total }
  } finally {
    await handle.close()
  }
}

const stateOf = (process: ShellExecution): JobState => process.status

export class HostJobs {
  private readonly byRef = new Map<string, Entry>()
  private readonly byId = new Map<string, Entry>()

  /** `ended` hears of every job that ends with nobody waiting for it: the app sends it to the Worker as a job frame. */
  constructor(
    private readonly ctx: Context,
    private readonly ended: (ended: JobEnded) => void,
  ) {
    ctx.jobs.attachController('mr-robot-host')
    ctx.jobs.events.subscribe({ owners: 'all' }, (event) => {
      if (event.type !== 'settled') return
      const entry = this.byId.get(event.job.id)
      if (entry === undefined) return
      entry.finishedAt = event.job.finishedAt ?? Date.now()
      // A wait that was pending carried the result to its caller. A kill is the Worker's own doing, and a teardown has nobody left to tell.
      if (event.awaited || event.cause !== 'producer') return
      const state = stateOf(entry.process)
      this.ended({ job: entry.ref, state: state === 'running' ? 'failed' : state, exitCode: entry.process.exitCode, signal: entry.process.signal })
    })
  }

  /** Register a process the caller has spawned as the job `ref`. */
  start(ref: string, command: string, process: ShellExecution): void {
    this.trim()
    const id = this.ctx.jobs.start({
      kind: SHELL_JOB_KIND,
      label: command,
      run: () => ({
        cancel: () => { process.kill() },
        done: process.done.then(() => (process.status === 'killed'
          ? { status: 'killed' as const, detail: process.signal === null ? 'killed before exit' : `signal: ${process.signal}` }
          : { status: 'completed' as const, detail: `exit code: ${process.exitCode ?? 0}` })),
      }),
    })
    const entry: Entry = { ref, id, command, startedAt: Date.now(), process, finishedAt: null }
    this.byRef.set(ref, entry)
    this.byId.set(id, entry)
  }

  /**
   * Wait up to `timeoutMs` for the job to end: true when it did, false when it is still running (it goes on as a job). A caller that
   * goes away first (`signal`, the connection that asked) ends only the wait, with an error: the command goes on as a job, and since
   * nobody waits for it any more its end is told with a job frame (deep review P11). A dropped connection is no reason to stop it.
   */
  async settled(ref: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const view = await this.ctx.jobs.wait(this.entry(ref).id, timeoutMs, undefined, signal)
    return view.status !== 'running' && view.status !== 'stopping'
  }

  /** Drop an ended job the app no longer keeps. */
  private release(ref: string): void {
    const entry = this.byRef.get(ref)
    if (entry === undefined) return
    this.byRef.delete(ref)
    this.byId.delete(entry.id)
    try { this.ctx.jobs.remove(entry.id) } catch { /* still running: the registry keeps it until it ends */ }
  }

  private entry(ref: string): Entry {
    const entry = this.byRef.get(ref)
    if (entry === undefined) throw new NoSuchJob(ref)
    return entry
  }

  private trim(): void {
    const ended = [...this.byRef.values()].filter((entry) => entry.finishedAt !== null).sort((a, b) => a.finishedAt! - b.finishedAt!)
    for (const entry of ended.slice(0, Math.max(0, ended.length - KEEP_ENDED + 1))) this.release(entry.ref)
  }

  /** The process of a job, for the answer that describes how it ended. */
  process(ref: string): ShellExecution {
    return this.entry(ref).process
  }

  /** What a job printed on one stream from a byte offset on. */
  async output(ref: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const { process } = this.entry(ref)
    const read = (stream === 'out' ? process.observed.stdout : process.observed.stderr).readFrom(offset)
    if (read.lossy && read.spillPath !== undefined) return readSpill(read.spillPath, offset, read.nextOffset)
    // Without a file behind it, a stream that outgrew memory answers with the end it still has, and the offset moves past the gap.
    return { text: read.text, bytes: read.nextOffset - offset, size: read.nextOffset }
  }

  /** Ask a job to stop. */
  stop(ref: string): 'requested' | 'already-finished' {
    return this.ctx.jobs.kill(this.entry(ref).id, undefined, 'stopped by the Robot')
  }

  /** Stop every job that still runs: this computer is no longer paired, so none of them can report anywhere (deep review P17). */
  stopAll(): void {
    for (const entry of this.byRef.values()) {
      if (entry.finishedAt === null) this.ctx.jobs.kill(entry.id, undefined, 'this computer was unpaired')
    }
  }

  /** The jobs of one Robot (their names start with its id and a colon). */
  list(robot: string): JobInfo[] {
    return [...this.byRef.values()].filter((entry) => entry.ref.startsWith(`${robot}:`)).map((entry) => ({
      job: entry.ref,
      command: entry.command,
      state: stateOf(entry.process),
      exitCode: entry.process.exitCode,
      signal: entry.process.signal,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
    }))
  }
}
