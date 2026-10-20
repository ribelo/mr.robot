import { globToRegExp, GREP_MAX_FILE_BYTES, GREP_MAX_LINE, GREP_MAX_MATCHES, LISTING_MAX_FILES, skipped } from '@mr-robot/host-protocol'
import type { BoxBackend, BoxFile, BoxJobStatus } from '../src/box/backend.ts'
import type { BoxFileList, BoxGrepMatch, BoxGrepQuery, BoxGrepResult } from '../src/box/box-search.ts'
import { main as ws, PERMIT_ENV, type WsIo } from '../../../infra/computer/ws-core.ts'

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

/** Commands run in the foreground (setup.sh at boot) that wait until the test releases them: robot id → command. */
const heldRuns = new Map<string, Set<string>>()
export const holdBoxRun = (robotId: string, command: string): void => { heldRuns.set(robotId, (heldRuns.get(robotId) ?? new Set()).add(command)) }
export const releaseBoxRun = (robotId: string, command: string): void => { heldRuns.get(robotId)?.delete(command) }

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

/** Split a shell command line into words, as the quoting of shellQuote writes them: single quotes keep everything, '\'' is a quote. */
function shellWords(line: string): string[] {
  const words: string[] = []
  let current = ''
  let started = false
  for (let at = 0; at < line.length; at++) {
    const char = line[at]!
    if (char === "'") {
      const end = line.indexOf("'", at + 1)
      current += line.slice(at + 1, end)
      at = end
      started = true
    } else if (char === '\\' && line[at + 1] !== undefined) {
      current += line[++at]
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) words.push(current)
  return words
}

/** The Box's network: where ws's requests go (the Worker's presign endpoint, and R2 by presigned URL). */
export type BoxNetwork = (url: string, init?: RequestInit) => Promise<Response>

/** A test's look at each request of ws as it goes out, per Robot: it may act as another script on the Box at that moment, over the Box's network. */
export const wsTaps = new Map<string, (url: string, init: RequestInit | undefined, network: BoxNetwork) => Promise<void>>()

/** The Box seam over memory (ao-33fs): no container, the same behaviour the Robot relies on. */
export class StubBox implements BoxBackend {
  constructor(private readonly robotId: string, private readonly network: BoxNetwork = async () => { throw new Error('this stub Box has no network') }) {}

  /**
   * Commands the stub Box really runs: ws (the program of the image, ws-core.ts, over this disk and this network) and the stat the Robot
   * asks for sizes. Anything else is scripted or echoed.
   */
  private async builtin(command: string, cwd: string, env: Readonly<Record<string, string>> = {}): Promise<{ stdout: string; stderr: string; exitCode: number } | undefined> {
    const words = shellWords(command)
    const disk = this.disk()
    const at = (path: string): string => (path.startsWith('/') ? path : `${cwd}/${path}`)
    if (words[0] === 'stat' && words[1] === '-c' && words[2] === '%s' && words[3] !== undefined) {
      const file = disk.get(at(words[3]))
      return file === undefined ? { stdout: '', stderr: 'No such file', exitCode: 1 } : { stdout: `${file.bytes.length}\n`, stderr: '', exitCode: 0 }
    }
    if (words[0] !== 'ws') return undefined
    let stdout = ''
    let stderr = ''
    const io: WsIo = {
      fetch: async (input, init) => {
        await wsTaps.get(this.robotId)?.(String(input), init, this.network)
        return this.network(String(input), init)
      },
      now: () => Date.now(),
      size: async (path) => disk.get(at(path))?.bytes.length,
      read: async (path, offset, length) => (disk.get(at(path))?.bytes ?? new Uint8Array()).slice(offset, offset + length),
      text: async (path) => { const file = disk.get(at(path)); return file === undefined ? undefined : new TextDecoder().decode(file.bytes) },
      create: async (path) => {
        let bytes = new Uint8Array()
        return {
          write: async (offset, piece) => {
            const grown = new Uint8Array(Math.max(bytes.length, offset + piece.length))
            grown.set(bytes)
            grown.set(piece, offset)
            bytes = grown
          },
          close: async () => { disk.set(at(path), { bytes, mtime: clock++ }) },
        }
      },
      remove: async (path) => { disk.delete(at(path)) },
      sleep: async () => undefined,
      out: (line) => { stdout += `${line}\n` },
      err: (line) => { stderr += `${line}\n` },
      permit: env[PERMIT_ENV],
    }
    const exitCode = await ws(words.slice(1), io)
    return { stdout, stderr, exitCode }
  }

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
    const real = await this.builtin(command, cwd)
    const answer = real ?? boxScripts.get(this.robotId)?.(command, new StubDisk(this.disk()))
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

  async run(command: string, cwd: string, _seconds?: number, env?: Readonly<Record<string, string>>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!running.has(this.robotId)) throw new Error('the Box is not running')
    this.log(`run ${cwd}: ${command}`)
    while (heldRuns.get(this.robotId)?.has(command) === true) await new Promise((resolve) => setTimeout(resolve, 10))
    const answer = (await this.builtin(command, cwd, env)) ?? boxScripts.get(this.robotId)?.(command, new StubDisk(this.disk()))
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

  async list(directory: string, pruned: readonly string[] = []): Promise<readonly BoxFile[]> {
    const prefix = `${directory}/`
    return [...this.disk().entries()]
      .filter(([path]) => path.startsWith(prefix) && !pruned.some((folder) => path.startsWith(`${prefix}${folder}/`)))
      .map(([path, file]) => ({ path: path.slice(prefix.length), size: file.bytes.byteLength, mtime: file.mtime }))
  }

  /** The files ripgrep would walk under /workspace: not the skipped directories at any depth, not .jobs; sorted, unlike rg. */
  private walked(under: string | undefined): Array<[string, Uint8Array]> {
    return [...this.disk().entries()]
      .filter(([path]) => path.startsWith('/workspace/'))
      .map(([path, file]): [string, Uint8Array] => [path.slice('/workspace/'.length), file.bytes])
      .filter(([path]) => !skipped(path) && !path.startsWith('.jobs/') && (under === undefined || path === under || path.startsWith(`${under}/`)))
      .sort(([a], [b]) => (a < b ? -1 : 1))
  }

  async files(under: string | undefined): Promise<BoxFileList> {
    const paths = this.walked(under).map(([path]) => path)
    return { paths: paths.slice(0, LISTING_MAX_FILES), truncated: paths.length > LISTING_MAX_FILES }
  }

  /** A JavaScript regular expression stands in for ripgrep's; binary files and files over the size limit are skipped as rg skips them. */
  async grep(query: BoxGrepQuery): Promise<BoxGrepResult> {
    let regex: RegExp
    try {
      regex = new RegExp(query.pattern, query.ignoreCase ? 'i' : '')
    } catch (error) {
      return { _tag: 'BadPattern', message: `rg: regex parse error: ${String(error)}` }
    }
    const glob = query.glob === undefined ? undefined : globToRegExp(query.glob)
    const found: BoxGrepMatch[] = []
    for (const [path, bytes] of this.walked(query.under)) {
      if (bytes.length > GREP_MAX_FILE_BYTES || (glob !== undefined && !glob.test(path))) continue
      const text = new TextDecoder().decode(bytes)
      if (text.includes('\u0000')) continue
      for (const [index, line] of text.split('\n').entries()) if (regex.test(line)) found.push({ path, line: index + 1, text: line.slice(0, GREP_MAX_LINE) })
    }
    return { _tag: 'Matches', matches: found.slice(0, GREP_MAX_MATCHES), truncated: found.length > GREP_MAX_MATCHES }
  }

  async stop(): Promise<void> {
    if (!running.delete(this.robotId)) return
    for (const [id, job] of jobs) if (id.startsWith(this.robotId + ':') && job.exit === null) job.gone = true
    this.log('stop')
  }
}
