/**
 * The Host app's side of copy (v1.16 ticket 06): real files and the real `fetch` for the copy engine of the protocol package.
 */
import { randomBytes } from 'node:crypto'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CopyFailed, type CopyIo, type HostAccess, type SourceFile, type TargetFile } from '@mr-robot/host-protocol'
import type { FileChange, FileChanges } from './file-change.ts'
import { filesBelow } from './files.ts'

export const nodeCopyIo: CopyIo = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** The size of a regular file. */
export async function fileSize(full: string): Promise<number> {
  const info = await stat(full)
  if (!info.isFile()) throw new CopyFailed({ message: `${full} is not a file` })
  return info.size
}

/** A file read by ranges, never whole. */
export function sourceFile(full: string): SourceFile {
  return {
    size: () => fileSize(full),
    read: async (offset, length) => {
      const handle = await open(full, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    },
  }
}

/** How long a part file waits for the next window of its copy before the app removes it: the Worker sends the next one within seconds. */
export const DOWNLOAD_IDLE_MS = 10 * 60_000

/** One download in flight: the file it goes to, its own part file, and whether a window is writing it now or the next one is awaited. */
interface OpenDownload {
  readonly target: string
  readonly partial: string
  /** The grant of the latest window: the idle clean-up removes the part file under it. */
  access: HostAccess
  /** The part file has been started (the first write truncates it). */
  started: boolean
  state: { readonly _tag: 'Writing' } | { readonly _tag: 'Waiting'; readonly timer: ReturnType<typeof setTimeout> }
}

const failure = (message: string, code: string): Error => Object.assign(new Error(message), { code })

/** The name of a copy's part file: the target's name, eight hex digits of its own, and this ending (HostDownloads.begin). */
const PART_FILE = /\.[0-9a-f]{8}\.mr-robot-part$/

/**
 * The downloads this run of the app has in flight (deep review P12), by the Worker's id of the copy. Each copy writes a part file of its
 * own beside its target and moves it there when it is whole, so nothing half-copied is ever at the path, and a second copy of the same
 * file (a retry while the first still runs) never writes into the first one's bytes. A part file goes when its copy fails or is stopped,
 * and when no window of its copy came for DOWNLOAD_IDLE_MS (the Worker gave up between windows). It outlives a reconnect, not the app.
 * Every write, the move and the clean-up are changes made through `changes`, so they run in the sandbox of the grant (file-change.ts): a
 * link planted at the part file's name leads nowhere.
 */
export class HostDownloads {
  private readonly open = new Map<string, OpenDownload>()

  constructor(private readonly changes: FileChanges, private readonly idleMs: number = DOWNLOAD_IDLE_MS) {}

  /**
   * The file one window of the copy `copy` writes into: a new part file for the first window, the copy's own for a later one. The
   * window's writes stop when `signal` is aborted.
   * @throws an error with code ECANCELED when a later window comes for a copy this app no longer has (it restarted, or the part file
   *   was removed for want of windows), EBUSY when a window of the copy is still writing, EEXIST for a first window of a known copy.
   */
  window(copy: string, target: string, access: HostAccess, first: boolean, signal: AbortSignal): TargetFile {
    const download = first ? this.begin(copy, target, access) : this.resume(copy, target, access)
    const change = (made: FileChange, body?: Uint8Array) => this.changes.change(access, made, body, signal)
    const write = async (offset: number, bytes: Uint8Array) => {
      await change({ _tag: 'Write', path: download.partial, offset, truncate: !download.started }, bytes)
      download.started = true
    }
    return {
      write,
      finish: async () => {
        if (!download.started) await write(0, new Uint8Array())
        await change({ _tag: 'Rename', from: download.partial, to: download.target })
        this.open.delete(copy)
      },
      release: async () => {
        const timer = setTimeout(() => { void this.expire(copy, download) }, this.idleMs)
        timer.unref?.()
        download.state = { _tag: 'Waiting', timer }
      },
      // The clean-up runs whatever the signal says: it is what a stopped copy leaves to do.
      abandon: async () => {
        this.open.delete(copy)
        await this.changes.change(access, { _tag: 'Remove', path: download.partial, missing: 'ignore' })
      },
    }
  }

  private begin(copy: string, target: string, access: HostAccess): OpenDownload {
    if (this.open.has(copy)) throw failure(`${target} was not written: the copy ${copy} has already started`, 'EEXIST')
    const download: OpenDownload = { target, partial: `${target}.${randomBytes(4).toString('hex')}.mr-robot-part`, access, started: false, state: { _tag: 'Writing' } }
    this.open.set(copy, download)
    return download
  }

  private resume(copy: string, target: string, access: HostAccess): OpenDownload {
    const download = this.open.get(copy)
    if (download === undefined || download.target !== target) throw failure(`${target} was not written: this copy stopped on this computer (the app restarted, or no part came for ${Math.round(this.idleMs / 60_000)} minutes). Copy the file again.`, 'ECANCELED')
    if (download.state._tag === 'Writing') throw failure(`${target} was not written: a part of this copy is still being written`, 'EBUSY')
    clearTimeout(download.state.timer)
    download.state = { _tag: 'Writing' }
    download.access = access
    return download
  }

  /**
   * Remove the part files that an earlier run of the app left in the Robots' directories when it stopped mid-copy (a crash, a power cut),
   * and spare those of the copies this one has in flight: a part file of this run is known here before it is made. Each removal runs in
   * the sandbox of the Robot whose directory holds the file, so a link swapped in on the way leads nowhere; on a computer with no sandbox
   * the files stay. Part files beside targets in other write roots are not looked for.
   */
  async removeLeftovers(): Promise<void> {
    const robots = join(this.changes.home, 'mr-robot')
    let base: string
    try {
      // A link at ~/mr-robot is not followed (access.ts refuses it).
      if (!(await lstat(robots)).isDirectory()) return
      base = await realpath(robots)
    } catch {
      return
    }
    for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue
      const access: HostAccess = { robot: entry.name, mode: 'workspace-write', roots: [] }
      for await (const below of filesBelow(join(base, entry.name))) {
        const path = join(base, entry.name, below)
        if (!PART_FILE.test(path) || [...this.open.values()].some((download) => download.partial === path)) continue
        await this.changes.change(access, { _tag: 'Remove', path, missing: 'ignore' }).catch(() => undefined)
      }
    }
  }

  /** No window came for the copy: its part file goes, unless a window took it up in the meantime. */
  private async expire(copy: string, download: OpenDownload): Promise<void> {
    if (this.open.get(copy) !== download || download.state._tag !== 'Waiting') return
    this.open.delete(copy)
    await this.changes.change(download.access, { _tag: 'Remove', path: download.partial, missing: 'ignore' }).catch(() => undefined)
  }
}
