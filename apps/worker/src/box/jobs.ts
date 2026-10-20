/**
 * Box jobs (v1.15 ticket 07): the way DSH's bash does it. box_run waits in the foreground up to its limit; a command that is still going
 * then goes on as a job (gb-lnph); run_in_background starts one at once (gb-lco0). job_list, job_output and job_kill manage them (gb-p4r5).
 * A job that ended wakes the Robot as a follow-up with its exit code and the tail of its output, the whole output under spill/jobs/
 * (gb-pptr). A job lives as long as its Box: the Box stays up while one runs (gb-5bfw), and a Box lost under a job marks it lost (gb-aafm).
 * The Robot's Turn may end while jobs run; the alarm looks at them every 15 seconds.
 */
import type { BoxBackend } from './backend.ts'
import type { BoxJobRow, RobotStore } from '../robot/store.ts'

export const JOB_CHECK_MS = 15_000
/** How long the output of a finished job is kept in the Wake-up: the last lines (gb-pptr). */
export const JOB_TAIL_LINES = 40
/** The most of one stream that goes to the Workspace log. */
export const JOB_LOG_MAX_BYTES = 5 * 1024 * 1024
/** The longest job_output waits when the Robot gives no time. */
export const JOB_WAIT_DEFAULT_MS = 30_000
export const JOB_WAIT_MAX_MS = 600_000

/** What the jobs need of the Robot around them. */
export interface JobsHost {
  readonly store: RobotStore
  /** The Box, started when it is not up. */
  boot(): Promise<BoxBackend>
  /** The Box as it is now: a job reads and kills through it only while it is up. */
  backend(): BoxBackend
  /** The Robot's own record says the Box is up. */
  up(): boolean
  saveLog(path: string, text: string): Promise<void>
  /** Wake the Robot as a follow-up. */
  wake(text: string, summary: string): Promise<void>
  /** The Box has been used just now: the idle stop counts from here. */
  touch(): Promise<void>
  changed(): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
}

export type RunResult =
  | { readonly kind: 'foreground'; readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  | { readonly kind: 'promoted'; readonly jobId: string; readonly stdout: string; readonly stderr: string; readonly note: string }
  | { readonly kind: 'background'; readonly jobId: string; readonly note: string }

/** The last n lines of a text. */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\n$/, '').split('\n')
  return lines.length <= n ? lines.join('\n') : [`… (${lines.length - n} earlier lines)`, ...lines.slice(-n)].join('\n')
}

const jobIdOf = (): string => `j-${crypto.randomUUID().slice(0, 8)}`

export class BoxJobs {
  constructor(private readonly host: JobsHost) {}

  /** The jobs a box_run is waiting for in this isolate. After a restart nobody waits, and such a job is a background job. */
  private readonly waiting = new Set<string>()

  private get store(): RobotStore {
    return this.host.store
  }

  /** box_run: foreground up to the limit, then a job; or a job at once. */
  async run(command: string, seconds: number, background: boolean, signal?: AbortSignal): Promise<RunResult> {
    const backend = await this.host.boot()
    const id = jobIdOf()
    this.store.addBoxJob(id, command, this.host.now())
    try {
      await backend.spawn(id, command, '/workspace')
    } catch (error) {
      this.store.closeBoxJob(id, 'lost', null, this.host.now(), null)
      throw error
    }
    await this.host.changed()
    if (background) {
      this.store.promoteBoxJob(id)
      await this.host.touch()
      return { kind: 'background', jobId: id, note: 'It runs on your Box. When it ends you are woken with its exit code and the end of its output. Look at it earlier with job_output, stop it with job_kill.' }
    }
    const deadline = this.host.now() + seconds * 1000
    this.waiting.add(id)
    try {
      const result = await this.wait(backend, id, deadline, signal)
      if (result !== undefined) return result
    } finally {
      this.waiting.delete(id)
    }
    // Still going at the limit, or the Turn was stopped: it becomes a job. What it printed so far is returned and counts as read.
    this.store.promoteBoxJob(id)
    const stdout = await this.readAll(backend, id, 'out', 0)
    const stderr = await this.readAll(backend, id, 'err', 0)
    this.store.setBoxJobOffsets(id, new TextEncoder().encode(stdout).length, new TextEncoder().encode(stderr).length)
    await this.host.touch()
    await this.host.changed()
    return { kind: 'promoted', jobId: id, stdout, stderr, note: `It was still running after ${seconds} s, so it goes on as job ${id}. When it ends you are woken with its exit code and the end of its output. Look at it with job_output, stop it with job_kill.` }
  }

  /** The foreground wait: the result when the command ended in time, undefined when the limit (or a stop) came first. */
  private async wait(backend: BoxBackend, id: string, deadline: number, signal: AbortSignal | undefined): Promise<RunResult | undefined> {
    for (let waited = 0; ; waited += 1) {
      const status = await backend.status(id)
      if (status.state === 'exited') {
        const stdout = await this.readAll(backend, id, 'out', 0)
        const stderr = await this.readAll(backend, id, 'err', 0)
        this.store.closeBoxJob(id, 'completed', status.exitCode, this.host.now(), null)
        await this.host.touch()
        await this.host.changed()
        return { kind: 'foreground', stdout, stderr, exitCode: status.exitCode }
      }
      if (status.state === 'gone') {
        this.store.closeBoxJob(id, 'lost', null, this.host.now(), null)
        await this.host.touch()
        throw new Error('The Box lost the command before it ended.')
      }
      if (this.host.now() >= deadline || signal?.aborted === true) return undefined
      await this.host.sleep(waited < 10 ? 200 : waited < 30 ? 500 : 2000)
    }
  }

  list(): Array<{ id: string; command: string; status: string; startedAt: string; endedAt: string | null; exitCode: number | null; log: string | null }> {
    return this.store.boxJobs().filter((job) => !job.foreground || job.status === 'running').map((job) => ({
      id: job.id, command: job.command, status: job.status, startedAt: new Date(job.startedAt).toISOString(), endedAt: job.finishedAt === null ? null : new Date(job.finishedAt).toISOString(), exitCode: job.exitCode, log: job.spill,
    }))
  }

  /** job_output: what the job printed since the Robot last read it; with wait, until it ends or the time is up. */
  async output(id: string, wait: boolean, timeoutMs: number): Promise<{ jobId: string; status: string; exitCode: number | null; stdout: string; stderr: string; note?: string }> {
    const job = this.store.boxJob(id)
    if (job === undefined) throw new Error(`no job ${id}; list them with job_list`)
    const limit = Math.min(Math.max(timeoutMs, 1000), JOB_WAIT_MAX_MS)
    const deadline = this.host.now() + limit
    let current = job
    if (wait && current.status === 'running') {
      for (;;) {
        await this.check()
        current = this.store.boxJob(id) ?? current
        if (current.status !== 'running' || this.host.now() >= deadline) break
        await this.host.sleep(1000)
      }
    }
    if (current.spill !== null && !this.host.up()) {
      return { jobId: id, status: current.status, exitCode: current.exitCode, stdout: '', stderr: '', note: `The Box has stopped. The whole output is in ${current.spill}; read it with read.` }
    }
    const backend = this.host.backend()
    const out = await this.readFrom(backend, id, 'out', current.outOffset)
    const err = await this.readFrom(backend, id, 'err', current.errOffset)
    this.store.setBoxJobOffsets(id, current.outOffset + out.bytes, current.errOffset + err.bytes)
    return {
      jobId: id, status: current.status, exitCode: current.exitCode, stdout: out.text, stderr: err.text,
      ...(current.status === 'running' ? { note: wait ? `It is still running after ${Math.round(limit / 1000)} s.` : 'It is still running; this is what it printed since you last looked.' } : current.spill === null ? {} : { note: `It has ended. The whole output is in ${current.spill}.` }),
    }
  }

  /** job_kill, or the owner's Stop in the panel (then the Robot is told). */
  async kill(id: string, by?: string): Promise<{ jobId: string; status: string }> {
    const job = this.store.boxJob(id)
    if (job === undefined) throw new Error(`no job ${id}; list them with job_list`)
    if (job.status !== 'running') return { jobId: id, status: `already ${job.status}` }
    const backend = this.host.backend()
    if (this.host.up()) await backend.kill(id).catch(() => undefined)
    const spill = await this.saveLog(id, job.command, backend)
    if (this.store.closeBoxJob(id, 'killed', null, this.host.now(), spill)) {
      await this.host.touch()
      if (by !== undefined && !job.foreground) await this.host.wake(`[Box job ${id} was stopped by ${by}]\n$ ${job.command}\nIt was killed before it ended. Do not start it again unless ${by} asks.${spill === null ? '' : `\nWhat it printed is in ${spill}.`}`, `Box job ${id} stopped by ${by}`)
    }
    await this.host.changed()
    return { jobId: id, status: 'killed' }
  }

  /**
   * The alarm (and job_output with wait): look at every running job. One that ended is closed and wakes the Robot; one the Box lost is
   * marked lost and wakes the Robot as failed (gb-aafm).
   */
  async check(): Promise<void> {
    const running = this.store.runningBoxJobs()
    if (running.length === 0) return
    const backend = this.host.backend()
    const alive = this.host.up() && (await backend.running().catch(() => false))
    for (const job of running) {
      const status = alive ? await backend.status(job.id).catch(() => ({ state: 'running' as const })) : ({ state: 'gone' as const })
      if (status.state === 'running') continue
      // A box_run is waiting for this one and will close it itself.
      if (this.waiting.has(job.id)) continue
      if (job.foreground) this.store.promoteBoxJob(job.id)
      await this.finish(job, status.state === 'exited' ? status.exitCode : null, alive ? backend : undefined)
    }
  }

  /** The Box is stopping: what still runs ends with it. */
  async loseAll(reason: string, backend?: BoxBackend): Promise<void> {
    for (const job of this.store.runningBoxJobs()) {
      if (this.waiting.has(job.id)) {
        this.store.closeBoxJob(job.id, 'lost', null, this.host.now(), null)
        continue
      }
      await this.finish(job, null, backend, reason)
    }
  }

  private async finish(job: BoxJobRow, exitCode: number | null, backend: BoxBackend | undefined, reason = 'the Box was lost while it ran'): Promise<void> {
    const spill = await this.saveLog(job.id, job.command, backend)
    const closed = this.store.closeBoxJob(job.id, exitCode === null ? 'lost' : 'completed', exitCode, this.host.now(), spill)
    if (!closed) return
    await this.host.touch()
    const tail = backend === undefined ? '' : await this.tail(backend, job.id)
    const head = exitCode === null ? `[Box job ${job.id} failed: ${reason}]` : `[Box job ${job.id} finished: exit ${exitCode}]`
    await this.host.wake(
      [head, `$ ${job.command}`, tail === '' ? '(it printed nothing)' : tail, spill === null ? '' : `The whole output is in ${spill}.`].filter((line) => line !== '').join('\n'),
      exitCode === null ? `Box job ${job.id} failed` : `Box job ${job.id} finished: exit ${exitCode}`,
    )
    await this.host.changed()
  }

  /** The last lines of what the job printed, stdout first, stderr after when there is any. */
  private async tail(backend: BoxBackend, id: string): Promise<string> {
    const [out, err] = await Promise.all([this.tailOf(backend, id, 'out'), this.tailOf(backend, id, 'err')])
    return [tailLines(out, JOB_TAIL_LINES), err.trim() === '' ? '' : `stderr:\n${tailLines(err, JOB_TAIL_LINES)}`].filter((part) => part.trim() !== '').join('\n')
  }

  private async tailOf(backend: BoxBackend, id: string, stream: 'out' | 'err'): Promise<string> {
    const first = await backend.output(id, stream, 0).catch(() => ({ text: '', bytes: 0, size: 0 }))
    if (first.size <= 65_536) return first.text
    return (await backend.output(id, stream, first.size - 65_536).catch(() => ({ text: '', bytes: 0, size: 0 }))).text
  }

  /** The whole output to the Workspace, both streams, as far as the cap allows. */
  private async saveLog(id: string, command: string, backend: BoxBackend | undefined): Promise<string | null> {
    if (backend === undefined) return null
    const out = await this.readAll(backend, id, 'out', 0).catch(() => '')
    const err = await this.readAll(backend, id, 'err', 0).catch(() => '')
    const path = `spill/jobs/${id}.log`
    await this.host.saveLog(path, [`$ ${command}`, '', out, err === '' ? '' : `\n--- stderr ---\n${err}`].join('\n'))
    return path
  }

  private async readFrom(backend: BoxBackend, id: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number }> {
    const piece = await backend.output(id, stream, offset)
    return { text: piece.text, bytes: piece.bytes }
  }

  private async readAll(backend: BoxBackend, id: string, stream: 'out' | 'err', from: number): Promise<string> {
    let offset = from
    let text = ''
    for (;;) {
      const piece = await backend.output(id, stream, offset)
      text += piece.text
      offset += piece.bytes
      if (piece.bytes === 0 || offset >= piece.size || offset >= JOB_LOG_MAX_BYTES) return text
    }
  }
}
