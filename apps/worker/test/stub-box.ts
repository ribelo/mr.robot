import type { BoxBackend, BoxFile, BoxJobStatus } from '../src/box/backend.ts'

/** What a stub Box did, per Robot: boots, commands with their directory, stops. */
export const boxLog = new Map<string, string[]>()
/** The stub Boxes' disks, per Robot: path → bytes and change time. */
export const boxDisks = new Map<string, Map<string, { bytes: Uint8Array; mtime: number }>>()
/** A scripted command: the test answers it; unanswered commands echo. */
export const boxScripts = new Map<string, (command: string, disk: StubDisk) => { stdout: string; stderr?: string; exitCode?: number } | undefined>()

/**
 * A scripted job (v1.15 ticket 07): the command's answer when it ends. A command the test holds with `holdBoxJob` stays running until
 * the test releases it; every other command ends at once with its scripted or echoed answer.
 */
interface StubJob { command: string; out: string; err: string; exit: number | null; gone: boolean }
const jobs = new Map<string, StubJob>()
/** Commands that stay running until `finishBoxJob`: robot id → command. */
const held = new Map<string, Set<string>>()
export const holdBoxJob = (robotId: string, command: string): void => { held.set(robotId, (held.get(robotId) ?? new Set()).add(command)) }
/** The held command ends with this output and exit code; it may print as it goes with `printBoxJob`. */
export function finishBoxJob(robotId: string, command: string, result: { stdout?: string; stderr?: string; exitCode?: number } = {}): void {
  const found = [...jobs.entries()].find(([id, job]) => id.startsWith(robotId + ':') && job.command === command && job.exit === null)
  if (found === undefined) throw new Error(`no running job for ${command}`)
  found[1].out += result.stdout ?? ''
  found[1].err += result.stderr ?? ''
  found[1].exit = result.exitCode ?? 0
}
export function printBoxJob(robotId: string, command: string, stdout: string): void {
  const found = [...jobs.entries()].find(([id, job]) => id.startsWith(robotId + ':') && job.command === command && job.exit === null)
  if (found === undefined) throw new Error(`no running job for ${command}`)
  found[1].out += stdout
}
/** The Box vanishes under its jobs (a restart): whatever ran is gone and left no exit code. */
export function loseBoxJobs(robotId: string): void {
  for (const [id, job] of jobs) if (id.startsWith(robotId + ':') && job.exit === null) job.gone = true
}
export const boxJobIds = (robotId: string): string[] => [...jobs.keys()].filter((id) => id.startsWith(robotId + ':')).map((id) => id.slice(robotId.length + 1))

const running = new Set<string>()
let clock = 1

export class StubDisk {
  constructor(private readonly files: Map<string, { bytes: Uint8Array; mtime: number }>) {}
  write(path: string, text: string): void {
    this.files.set(path, { bytes: new TextEncoder().encode(text), mtime: clock++ })
  }
  read(path: string): string | undefined {
    const file = this.files.get(path)
    return file === undefined ? undefined : new TextDecoder().decode(file.bytes)
  }
}

/** The Box seam over memory (ao-33fs): no container, the same behaviour the Robot relies on. */
export class StubBox implements BoxBackend {
  constructor(private readonly robotId: string) {}

  private log(entry: string): void {
    const list = boxLog.get(this.robotId) ?? []
    list.push(entry)
    boxLog.set(this.robotId, list)
  }

  private disk(): Map<string, { bytes: Uint8Array; mtime: number }> {
    let disk = boxDisks.get(this.robotId)
    if (disk === undefined) {
      disk = new Map()
      boxDisks.set(this.robotId, disk)
    }
    return disk
  }

  async start(): Promise<void> {
    if (running.has(this.robotId)) return
    running.add(this.robotId)
    // A booted Box has a fresh disk: only what the Robot copies in is there.
    boxDisks.set(this.robotId, new Map())
    this.log('boot')
  }

  async running(): Promise<boolean> {
    return running.has(this.robotId)
  }

  private jobKey(job: string): string {
    return `${this.robotId}:${job}`
  }

  async spawn(job: string, command: string, cwd: string): Promise<void> {
    if (!running.has(this.robotId)) throw new Error('the Box is not running')
    this.log(`spawn ${cwd}: ${command}`)
    if (held.get(this.robotId)?.has(command) === true) {
      jobs.set(this.jobKey(job), { command, out: '', err: '', exit: null, gone: false })
      return
    }
    const answer = boxScripts.get(this.robotId)?.(command, new StubDisk(this.disk()))
    jobs.set(this.jobKey(job), { command, out: answer?.stdout ?? `ran: ${command}`, err: answer?.stderr ?? '', exit: answer?.exitCode ?? 0, gone: false })
  }

  async status(job: string): Promise<BoxJobStatus> {
    const found = jobs.get(this.jobKey(job))
    if (found === undefined || found.gone) return { state: 'gone' }
    return found.exit === null ? { state: 'running' } : { state: 'exited', exitCode: found.exit }
  }

  async output(job: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const found = jobs.get(this.jobKey(job))
    const bytes = new TextEncoder().encode(found === undefined ? '' : stream === 'out' ? found.out : found.err)
    const piece = bytes.subarray(offset, offset + 262_144)
    return { text: new TextDecoder().decode(piece), bytes: piece.length, size: bytes.length }
  }

  async kill(job: string): Promise<void> {
    const found = jobs.get(this.jobKey(job))
    if (found !== undefined && found.exit === null) found.exit = 143
    this.log(`kill ${job}`)
  }

  async run(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!running.has(this.robotId)) throw new Error('the Box is not running')
    this.log(`run ${cwd}: ${command}`)
    const answer = boxScripts.get(this.robotId)?.(command, new StubDisk(this.disk()))
    return { stdout: answer?.stdout ?? `ran: ${command}`, stderr: answer?.stderr ?? '', exitCode: answer?.exitCode ?? 0 }
  }

  async read(path: string): Promise<Uint8Array | null> {
    return this.disk().get(path)?.bytes ?? null
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.disk().set(path, { bytes, mtime: clock++ })
  }

  async remove(path: string): Promise<void> {
    this.disk().delete(path)
  }

  async list(directory: string): Promise<readonly BoxFile[]> {
    const prefix = `${directory}/`
    return [...this.disk().entries()].filter(([path]) => path.startsWith(prefix)).map(([path, file]) => ({ path: path.slice(prefix.length), size: file.bytes.byteLength, mtime: file.mtime }))
  }

  async stop(): Promise<void> {
    if (!running.delete(this.robotId)) return
    for (const [id, job] of jobs) if (id.startsWith(this.robotId + ':') && job.exit === null) job.gone = true
    this.log('stop')
  }
}
