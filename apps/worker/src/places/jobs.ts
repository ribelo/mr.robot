/**
 * Jobs, one registry per Robot (v1.15 ticket 07, v1.16 ticket 01): the way DSH's bash does it. run waits in the foreground up to its
 * limit; a command that is still going then goes on as a job (gb-lnph); run_in_background starts one at once (gb-lco0). job_list,
 * job_output and job_kill manage them wherever they run (gb-p4r5, ob-rc3b). A job that ended wakes the Robot as a follow-up with its
 * exit code and the tail of its output, the whole output under spill/jobs/ (gb-pptr). A Box job lives as long as its Box: the Box stays
 * up while one runs (gb-5bfw), and a Box lost under a job marks it lost (gb-aafm). The Robot's Turn may end while jobs run; the alarm
 * looks at them every 15 seconds.
 */
import type { BoxJobStatus } from '../box/backend.ts'
import type { JobRow, RobotStore } from '../robot/store.ts'
import type { StoredPlace } from './host-facet.ts'
import { newJobId, type JobId } from './job-id.ts'

export const JOB_CHECK_MS = 15_000
/** How long the output of a finished job is kept in the Wake-up: the last lines (gb-pptr). */
export const JOB_TAIL_LINES = 40
/** The most of one stream that goes to the Workspace log. */
export const JOB_LOG_MAX_BYTES = 5 * 1024 * 1024
/** The longest job_output waits when the Robot gives no time. */
export const JOB_WAIT_DEFAULT_MS = 30_000
export const JOB_WAIT_MAX_MS = 600_000

/** What the jobs of one place can do: the Box backend is one, a Host's runner another. */
export interface JobRunner {
  /** Start a command that goes on by itself; the call returns once it is started. */
  spawn(job: JobId, command: string, cwd: string | undefined, options: SpawnOptions): Promise<void>
  status(job: JobId): Promise<BoxJobStatus>
  /** The output of one stream of a job from a byte offset on, and the size of that stream now. */
  output(job: JobId, stream: 'out' | 'err', offset: number): Promise<{ readonly text: string; readonly bytes: number; readonly size: number }>
  kill(job: JobId): Promise<void>
  /** The registry has closed the job: whatever the runner kept in memory for it (a pending call, an answer) can go. */
  release(job: JobId): void
  /** Why the command never ran (a Host refused the call), when that is why the job is gone: the call's error as it was, a tagged refusal tagged. */
  refusal?(job: JobId): Error | undefined
  /** What a finished command adds to its result beside the output: its directory, the sandbox's facts and a note. */
  extras?(job: JobId): RunExtras | undefined
}

/** What a runner is told about a command beside the command: how long the Robot waits for it, and whether it is a job from the start. */
export interface SpawnOptions {
  readonly seconds: number
  readonly background: boolean
}

/** The sandbox as the Robot sees it in a result (ticket 02): the mode, whether a write was denied (and where), and how completely it is enforced. */
export interface RunSandbox {
  readonly mode: string
  readonly denied: boolean
  readonly deniedPath?: string
  readonly enforcement?: string
}

export interface RunExtras {
  readonly cwd?: string
  readonly sandbox?: RunSandbox
  readonly note?: string
}

/** How a place is named in the words the Robot reads: the Box and a Host differ in article and in what "lost" means. */
export interface PlaceWords {
  /** The name the Robot gives in `on` and sees in job_list: "box", or the Host's name. */
  readonly name: string
  /** The word in notices ("[Box job j-1 finished]"): "Box", or the Host's name. */
  readonly label: string
  /** After "it runs on": "your Box", or the Host's name. */
  readonly on: string
  /** The place as a sentence's subject: "The Box", or the Host's name. */
  readonly subject: string
  /** Why a job that was running there is gone, when nothing more is known. */
  readonly lost: string
}

/** One place that runs jobs, as the Robot offers it. */
export interface JobPlace extends PlaceWords {
  readonly place: StoredPlace
  /** The runner, started when it is not up (the Box boots). */
  start(): Promise<JobRunner>
  /** The runner as it is now: a job reads and kills through it only while the place is up. */
  runner(): JobRunner
  /** Whether the place is up now: the Box's container runs; a Host answers for its jobs itself. */
  alive(): Promise<boolean>
  /** The place has been used just now: the Box's idle stop counts from here. */
  touch(): Promise<void>
}

/** What the jobs need of the Robot around them. */
export interface JobsHost {
  readonly store: RobotStore
  /** The place a stored job ran in, from its stored name and the Host's name at the time. */
  place(place: StoredPlace, name: string | null): JobPlace
  saveLog(path: string, text: string): Promise<void>
  /** Wake the Robot as a follow-up. */
  wake(text: string, summary: string): Promise<void>
  changed(): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
}

/** What job_output answers. */
export interface JobOutputView {
  readonly jobId: JobId
  readonly status: string
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly note?: string
}

/** What job_kill answers. */
export interface KillView {
  readonly jobId: JobId
  readonly status: string
}

/** What a run asks of a place: the command, where it starts, how long to wait, and whether to start it as a job at once. */
export interface RunSpec {
  readonly command: string
  readonly cwd: string | undefined
  readonly seconds: number
  readonly background: boolean
}

export type RunResult =
  | ({ readonly kind: 'foreground'; readonly stdout: string; readonly stderr: string; readonly exitCode: number } & RunExtras)
  | { readonly kind: 'promoted'; readonly jobId: JobId; readonly stdout: string; readonly stderr: string; readonly note: string }
  | { readonly kind: 'background'; readonly jobId: JobId; readonly note: string }

export interface JobEntry {
  readonly id: JobId
  readonly place: string
  readonly command: string
  readonly status: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly exitCode: number | null
  readonly log: string | null
}

/** The last n lines of a text. */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\n$/, '').split('\n')
  return lines.length <= n ? lines.join('\n') : [`… (${lines.length - n} earlier lines)`, ...lines.slice(-n)].join('\n')
}

export class Jobs {
  constructor(private readonly host: JobsHost) {}

  /** The jobs a run is waiting for in this isolate. After a restart nobody waits, and such a job is a background job. */
  private readonly waiting = new Set<JobId>()

  private get store(): RobotStore {
    return this.host.store
  }

  private placeOf(job: JobRow): JobPlace {
    return this.host.place(job.place, job.placeName)
  }

  /** Close a job in the store and let its runner forget it. */
  private close(where: JobPlace, id: JobId, status: 'completed' | 'killed' | 'lost', exitCode: number | null, spill: string | null): boolean {
    const closed = this.store.closeJob(id, status, exitCode, this.host.now(), spill)
    where.runner().release(id)
    return closed
  }

  /** run: foreground up to the limit, then a job; or a job at once. */
  async run(where: JobPlace, spec: RunSpec, signal?: AbortSignal): Promise<RunResult> {
    const { command, cwd, seconds, background } = spec
    const runner = await where.start()
    const id = newJobId()
    this.store.addJob(id, where.place, where.label, command, this.host.now())
    try {
      await runner.spawn(id, command, cwd, { seconds, background })
    } catch (error) {
      this.close(where, id, 'lost', null, null)
      throw error
    }
    await this.host.changed()
    if (background) {
      this.store.promoteJob(id)
      await where.touch()
      return { kind: 'background', jobId: id, note: `It runs on ${where.on}. When it ends you are woken with its exit code and the end of its output. Look at it earlier with job_output, stop it with job_kill.` }
    }
    const deadline = this.host.now() + seconds * 1000
    this.waiting.add(id)
    try {
      const result = await this.wait(where, runner, id, deadline, signal)
      if (result !== undefined) return result
    } finally {
      this.waiting.delete(id)
    }
    // Still going at the limit, or the Turn was stopped: it becomes a job. What it printed so far is returned and counts as read. A Host
    // that is away now (its connection dropped while it ran the command, deep review P11) keeps the job: its output is read later.
    this.store.promoteJob(id)
    const printed = await Promise.all([this.readAll(runner, id, 'out', 0), this.readAll(runner, id, 'err', 0)]).catch(() => ['', ''] as const)
    const [stdout, stderr] = printed
    this.store.setJobOffsets(id, new TextEncoder().encode(stdout).length, new TextEncoder().encode(stderr).length)
    await where.touch()
    await this.host.changed()
    return { kind: 'promoted', jobId: id, stdout, stderr, note: `It was still running after ${seconds} s, so it goes on as job ${id}. When it ends you are woken with its exit code and the end of its output. Look at it with job_output, stop it with job_kill.` }
  }

  /** The foreground wait: the result when the command ended in time, undefined when the limit (or a stop) came first. */
  private async wait(where: JobPlace, runner: JobRunner, id: JobId, deadline: number, signal: AbortSignal | undefined): Promise<RunResult | undefined> {
    for (let waited = 0; ; waited += 1) {
      const status = await runner.status(id)
      if (status.state === 'exited') {
        const stdout = await this.readAll(runner, id, 'out', 0)
        const stderr = await this.readAll(runner, id, 'err', 0)
        const extras = runner.extras?.(id)
        this.close(where, id, 'completed', status.exitCode, null)
        await where.touch()
        await this.host.changed()
        return { kind: 'foreground', stdout, stderr, exitCode: status.exitCode, ...extras }
      }
      if (status.state === 'gone') {
        // A Host that refused the call says so as it is: the command never ran. Otherwise a Host says why in the error stream of the call that failed.
        const refused = runner.refusal?.(id)
        const why = refused !== undefined || where.place === 'box' ? '' : (await runner.output(id, 'err', 0).catch(() => ({ text: '' }))).text.trim()
        this.close(where, id, 'lost', null, null)
        await where.touch()
        if (refused !== undefined) throw refused
        throw new Error(`${where.subject} lost the command before it ended.${why === '' ? '' : ` ${why}`}`)
      }
      if (this.host.now() >= deadline || signal?.aborted === true) return undefined
      await this.host.sleep(waited < 10 ? 200 : waited < 30 ? 500 : 2000)
    }
  }

  list(): JobEntry[] {
    return this.store.jobs().filter((job) => !job.foreground || job.status === 'running').map((job) => ({
      id: job.id, place: this.placeOf(job).name, command: job.command, status: job.status, startedAt: new Date(job.startedAt).toISOString(), endedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(), exitCode: job.exitCode, log: job.spill,
    }))
  }

  /** The place a job runs in, for the grant its calls use; undefined for a job that does not exist. */
  placeOfJob(id: JobId): StoredPlace | undefined {
    return this.store.job(id)?.place
  }

  /** job_output: what the job printed since the Robot last read it; with wait, until it ends or the time is up. */
  async output(id: JobId, wait: boolean, timeoutMs: number): Promise<JobOutputView> {
    const job = this.store.job(id)
    if (job === undefined) throw new Error(`no job ${id}; list them with job_list`)
    const limit = Math.min(Math.max(timeoutMs, 1000), JOB_WAIT_MAX_MS)
    const deadline = this.host.now() + limit
    let current = job
    if (wait && current.status === 'running') {
      for (;;) {
        await this.check()
        current = this.store.job(id) ?? current
        if (current.status !== 'running' || this.host.now() >= deadline) break
        await this.host.sleep(1000)
      }
    }
    const where = this.placeOf(current)
    if (current.spill !== null && !(await where.alive())) {
      return { jobId: id, status: current.status, exitCode: current.exitCode, stdout: '', stderr: '', note: `${where.subject} has stopped. The whole output is in ${current.spill}; read it with read on "files".` }
    }
    const runner = where.runner()
    let out: { text: string; bytes: number }
    let err: { text: string; bytes: number }
    try {
      out = await this.readFrom(runner, id, 'out', current.outOffset)
      err = await this.readFrom(runner, id, 'err', current.errOffset)
    } catch (error) {
      // A Host drops the jobs it ended after a while, and forgets all of them when its app restarts; the log is what is left.
      if (current.status !== 'running' && current.spill !== null) return { jobId: id, status: current.status, exitCode: current.exitCode, stdout: '', stderr: '', note: `The job has ended and ${where.label} no longer holds it. The whole output is in ${current.spill}; read it with read on "files".` }
      throw error
    }
    this.store.setJobOffsets(id, current.outOffset + out.bytes, current.errOffset + err.bytes)
    return {
      jobId: id, status: current.status, exitCode: current.exitCode, stdout: out.text, stderr: err.text,
      ...(current.status === 'running' ? { note: wait ? `It is still running after ${Math.round(limit / 1000)} s.` : 'It is still running; this is what it printed since you last looked.' } : current.spill === null ? {} : { note: `It has ended. The whole output is in ${current.spill}.` }),
    }
  }

  /** job_kill, or the owner's Stop in the panel (then the Robot is told). */
  async kill(id: JobId, by?: string): Promise<KillView> {
    const job = this.store.job(id)
    if (job === undefined) throw new Error(`no job ${id}; list them with job_list`)
    if (job.status !== 'running') return { jobId: id, status: `already ${job.status}` }
    const where = this.placeOf(job)
    const alive = await where.alive()
    if (alive) await where.runner().kill(id).catch(() => undefined)
    const spill = await this.saveLog(id, job.command, alive ? where.runner() : undefined)
    if (this.close(where, id, 'killed', null, spill)) {
      await where.touch()
      if (by !== undefined && !job.foreground) await this.host.wake(`[${where.label} job ${id} was stopped by ${by}]\n$ ${job.command}\nIt was killed before it ended. Do not start it again unless ${by} asks.${spill === null ? '' : `\nWhat it printed is in ${spill}.`}`, `${where.label} job ${id} stopped by ${by}`)
    }
    await this.host.changed()
    return { jobId: id, status: 'killed' }
  }

  /**
   * The alarm (and job_output with wait): look at every running job. One that ended is closed and wakes the Robot; one its place lost is
   * marked lost and wakes the Robot as failed (gb-aafm).
   */
  async check(): Promise<void> {
    const running = this.store.runningJobs()
    if (running.length === 0) return
    const alive = new Map<StoredPlace, boolean>()
    for (const job of running) {
      const where = this.placeOf(job)
      if (!alive.has(job.place)) alive.set(job.place, await where.alive().catch(() => false))
      const up = alive.get(job.place) === true
      const status = up ? await where.runner().status(job.id).catch(() => ({ state: 'running' as const })) : ({ state: 'gone' as const })
      if (status.state === 'running') continue
      // A run is waiting for this one and will close it itself.
      if (this.waiting.has(job.id)) continue
      if (job.foreground) this.store.promoteJob(job.id)
      await this.finish(job, status.state === 'exited' ? status.exitCode : null, up ? where.runner() : undefined)
    }
  }

  /**
   * The Host `place` says a job of its own ended (the job frame, ob-ku5j): it is closed and the Robot is woken, once. A Host speaks only
   * for the jobs that run on it: a frame about a job of another place changes nothing.
   */
  async hostEnded(place: StoredPlace, id: JobId, ended: { readonly state: 'completed' | 'killed' | 'failed'; readonly exitCode: number | null; readonly signal: string | null }): Promise<void> {
    const job = this.store.job(id)
    // A run waiting for it in this isolate closes it itself.
    if (job === undefined || job.place !== place || job.status !== 'running' || this.waiting.has(id)) return
    if (job.foreground) this.store.promoteJob(id)
    const stopped = ended.state === 'completed' ? undefined : ended.signal === null ? `it was ${ended.state}` : `it was stopped by signal ${ended.signal}`
    await this.finish(job, ended.state === 'completed' ? ended.exitCode : null, this.placeOf(job).runner(), stopped)
  }

  /** The Member says these Host jobs are gone (the app restarted, the Host stayed away too long or can no longer be reached): they are lost, and the Robot is woken as failed (ob-cgn1). */
  async lose(ids: readonly JobId[], reason: string): Promise<void> {
    for (const id of ids) {
      const job = this.store.job(id)
      if (job === undefined || job.status !== 'running' || this.waiting.has(id)) continue
      await this.finish(job, null, undefined, reason)
    }
  }

  /** The Box is stopping: what still runs on it ends with it. */
  async loseAll(reason: string, runner?: JobRunner): Promise<void> {
    for (const job of this.store.runningJobs('box')) {
      if (this.waiting.has(job.id)) {
        this.close(this.placeOf(job), job.id, 'lost', null, null)
        continue
      }
      await this.finish(job, null, runner, reason)
    }
  }

  private async finish(job: JobRow, exitCode: number | null, runner: JobRunner | undefined, reason?: string): Promise<void> {
    const where = this.placeOf(job)
    const spill = await this.saveLog(job.id, job.command, runner)
    const closed = this.close(where, job.id, exitCode === null ? 'lost' : 'completed', exitCode, spill)
    if (!closed) return
    await where.touch()
    const tail = runner === undefined ? '' : await this.tail(runner, job.id)
    const head = exitCode === null ? `[${where.label} job ${job.id} failed: ${reason ?? where.lost}]` : `[${where.label} job ${job.id} finished: exit ${exitCode}]`
    await this.host.wake(
      [head, `$ ${job.command}`, tail === '' ? '(it printed nothing)' : tail, spill === null ? '' : `The whole output is in ${spill}.`].filter((line) => line !== '').join('\n'),
      exitCode === null ? `${where.label} job ${job.id} failed` : `${where.label} job ${job.id} finished: exit ${exitCode}`,
    )
    await this.host.changed()
  }

  /** The last lines of what the job printed, stdout first, stderr after when there is any. */
  private async tail(runner: JobRunner, id: JobId): Promise<string> {
    const [out, err] = await Promise.all([this.tailOf(runner, id, 'out'), this.tailOf(runner, id, 'err')])
    return [tailLines(out, JOB_TAIL_LINES), err.trim() === '' ? '' : `stderr:\n${tailLines(err, JOB_TAIL_LINES)}`].filter((part) => part.trim() !== '').join('\n')
  }

  private async tailOf(runner: JobRunner, id: JobId, stream: 'out' | 'err'): Promise<string> {
    const first = await runner.output(id, stream, 0).catch(() => ({ text: '', bytes: 0, size: 0 }))
    if (first.size <= 65_536) return first.text
    return (await runner.output(id, stream, first.size - 65_536).catch(() => ({ text: '', bytes: 0, size: 0 }))).text
  }

  /** The whole output to the Workspace, both streams, as far as the cap allows. */
  private async saveLog(id: JobId, command: string, runner: JobRunner | undefined): Promise<string | null> {
    if (runner === undefined) return null
    const out = await this.readAll(runner, id, 'out', 0).catch(() => '')
    const err = await this.readAll(runner, id, 'err', 0).catch(() => '')
    const path = `spill/jobs/${id}.log`
    await this.host.saveLog(path, [`$ ${command}`, '', out, err === '' ? '' : `\n--- stderr ---\n${err}`].join('\n'))
    return path
  }

  private async readFrom(runner: JobRunner, id: JobId, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number }> {
    const piece = await runner.output(id, stream, offset)
    return { text: piece.text, bytes: piece.bytes }
  }

  private async readAll(runner: JobRunner, id: JobId, stream: 'out' | 'err', from: number): Promise<string> {
    let offset = from
    let text = ''
    for (;;) {
      const piece = await runner.output(id, stream, offset)
      text += piece.text
      offset += piece.bytes
      if (piece.bytes === 0 || offset >= piece.size || offset >= JOB_LOG_MAX_BYTES) return text
    }
  }
}
