import type { BoxBackend, BoxFile } from '../src/box/backend.ts'

/** What a stub Box did, per Robot: boots, commands with their directory, stops. */
export const boxLog = new Map<string, string[]>()
/** The stub Boxes' disks, per Robot: path → bytes and change time. */
export const boxDisks = new Map<string, Map<string, { bytes: Uint8Array; mtime: number }>>()
/** A scripted command: the test answers it; unanswered commands echo. */
export const boxScripts = new Map<string, (command: string, disk: StubDisk) => { stdout: string; stderr?: string; exitCode?: number } | undefined>()

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

  async list(directory: string): Promise<readonly BoxFile[]> {
    const prefix = `${directory}/`
    return [...this.disk().entries()].filter(([path]) => path.startsWith(prefix)).map(([path, file]) => ({ path: path.slice(prefix.length), size: file.bytes.byteLength, mtime: file.mtime }))
  }

  async stop(): Promise<void> {
    if (!running.delete(this.robotId)) return
    this.log('stop')
  }
}
