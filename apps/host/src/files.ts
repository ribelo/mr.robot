/**
 * The files of this computer for a Robot (v1.2, v1.16 ticket 02): read, list and search in Node, write and delete through a small Node
 * program of the app's own, so file tools work the same on every OS and do not depend on a shell. Relative paths start in the Robot's directory; reads are as wide as the OS user;
 * every change runs in the sandbox under the grant's mode and roots (file-change.ts), after a first check of the path (access.ts).
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { globBase, globToRegExp, GREP_MAX_FILE_BYTES, GREP_MAX_LINE, GREP_MAX_MATCHES, isSkippedDirectory, type HostAccess, type TargetFile } from '@mr-robot/host-protocol'
import { assertMayRemove, assertMayWrite, ensureRobotDirectory, expandPath, resolvedPath } from './access.ts'
import type { HostDownloads } from './copy.ts'
import { errorCode } from './error-code.ts'
import type { FileChanges } from './file-change.ts'

const MAX_READ = 10 * 1024 * 1024
/** The most files a listing returns, and the most a search looks into. */
const LISTING_LIMIT = 20_000

export interface FileMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

/** A failure with an OS-style code (ENOENT, EISDIR, EFBIG) that the Worker shows after the message. */
const failure = (message: string, code: string): Error => Object.assign(new Error(message), { code })

/** The files below a directory, depth first, as paths relative to it with / between the parts; .git and node_modules are not entered. */
async function* filesBelow(directory: string, prefix = ''): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!isSkippedDirectory(entry.name)) yield* filesBelow(join(directory, entry.name), `${prefix}${entry.name}/`)
    } else if (entry.isFile()) {
      yield `${prefix}${entry.name}`
    }
  }
}

/** A path as the Robot sees it in a listing: the base as it gave it, then the path below. */
const shown = (base: string, below: string): string => (base === '.' ? below : base.endsWith('/') ? `${base}${below}` : `${base}/${below}`)

export class HostDisk {
  private readonly home: string

  constructor(private readonly changes: FileChanges, private readonly downloads: HostDownloads) {
    this.home = changes.home
  }

  private async full(access: HostAccess, path: string): Promise<string> {
    return expandPath(this.home, await ensureRobotDirectory(this.home, access), path)
  }

  async read(access: HostAccess, path: string): Promise<{ path: string; size: number; text: string | null; base64: string | null }> {
    const full = await this.full(access, path)
    const info = await stat(full)
    if (info.size > MAX_READ) throw failure(`${full} is ${info.size} bytes; files over 10 MB are not read`, 'EFBIG')
    const body = await readFile(full)
    try {
      return { path: full, size: body.length, text: new TextDecoder('utf-8', { fatal: true }).decode(body), base64: null }
    } catch {
      return { path: full, size: body.length, text: null, base64: body.toString('base64') }
    }
  }

  async write(access: HostAccess, path: string, input: { text?: string | undefined; base64?: string | undefined }): Promise<{ path: string; bytes: number }> {
    const full = await this.full(access, path)
    const body = input.base64 !== undefined ? Buffer.from(input.base64, 'base64') : Buffer.from(input.text ?? '', 'utf8')
    await assertMayWrite(this.home, access, full)
    await this.changes.change(access, { _tag: 'Write', path: full, offset: 0, truncate: true }, body)
    return { path: full, bytes: body.length }
  }

  /** A file to read as a copy's source: the path as the app resolves it (reads are as wide as the OS user). */
  readable(access: HostAccess, path: string): Promise<string> {
    return this.full(access, path)
  }

  /**
   * The file one window of the copy `copy` writes, where the mode and roots may allow it: the path with its links followed, as a write
   * follows them (the part file is moved onto the file a link names, not onto the link). The part file and the move run in the sandbox,
   * which refuses them when the links lead out of the roots. The window's writes stop when `signal` is aborted.
   */
  async target(access: HostAccess, path: string, window: { readonly copy: string; readonly first: boolean }, signal: AbortSignal): Promise<{ readonly path: string; readonly file: TargetFile }> {
    const full = await this.full(access, path)
    await assertMayWrite(this.home, access, full)
    const real = await resolvedPath(full)
    return { path: real, file: this.downloads.window(window.copy, real, access, window.first, signal) }
  }

  async glob(access: HostAccess, pattern: string): Promise<{ paths: string[]; truncated: boolean }> {
    const base = globBase(pattern)
    const matcher = globToRegExp(pattern)
    const root = await this.full(access, base)
    const paths: string[] = []
    let count = 0
    for await (const below of filesBelow(root)) {
      count += 1
      if (count > LISTING_LIMIT) return { paths: paths.sort(), truncated: true }
      const path = shown(base, below)
      if (matcher.test(path)) paths.push(path)
    }
    return { paths: paths.sort(), truncated: false }
  }

  async grep(access: HostAccess, input: { pattern: string; ignoreCase: boolean; glob?: string | undefined; path?: string | undefined }): Promise<{ matches: FileMatch[] }> {
    const regex = new RegExp(input.pattern, input.ignoreCase ? 'i' : '')
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const base = input.path ?? '.'
    const root = await this.full(access, base)
    const matches: FileMatch[] = []
    const search = async (full: string, path: string): Promise<void> => {
      if (files !== undefined && !files.test(path)) return
      if ((await stat(full)).size > GREP_MAX_FILE_BYTES) return
      const text = await readFile(full, 'utf8').catch(() => undefined)
      if (text === undefined || text.includes('\u0000')) return
      for (const [index, line] of text.split('\n').entries()) {
        if (matches.length >= GREP_MAX_MATCHES) return
        if (regex.test(line)) matches.push({ path, line: index + 1, text: line.slice(0, GREP_MAX_LINE) })
      }
    }
    if ((await stat(root)).isFile()) {
      await search(root, base)
      return { matches }
    }
    let count = 0
    for await (const below of filesBelow(root)) {
      count += 1
      if (matches.length >= GREP_MAX_MATCHES || count > LISTING_LIMIT) break
      await search(join(root, below), shown(base, below))
    }
    return { matches }
  }

  async remove(access: HostAccess, path: string): Promise<{ path: string }> {
    const full = await this.full(access, path)
    await assertMayRemove(this.home, access, full)
    try {
      await this.changes.change(access, { _tag: 'Remove', path: full, missing: 'fail' })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw failure(`No file ${full}; nothing was deleted.`, 'ENOENT')
      if (errorCode(error) === 'EISDIR') throw failure(`${full} is not a file; only files are deleted.`, 'EISDIR')
      throw error
    }
    return { path: full }
  }
}
