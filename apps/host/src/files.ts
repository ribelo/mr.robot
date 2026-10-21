/**
 * The files of this computer for a Robot (v1.2, v1.16 ticket 02): read, list and search in Node, write and delete through a small Node
 * program of the app's own, so file tools work the same on every OS and do not depend on a shell. Relative paths start in the Robot's directory; reads are as wide as the OS user;
 * every change runs in the sandbox under the grant's mode and roots (file-change.ts), after a first check of the path (access.ts).
 */
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { globBase, globToRegExp, GREP_MAX_FILE_BYTES, GREP_MAX_LINE, GREP_MAX_MATCHES, isSkippedDirectory, LIST_DIRECTORY_MAX, LISTING_MAX_FILES, OUTSIDE_REPOSITORY, type HostAccess, type TargetFile } from '@mr-robot/host-protocol'
import { assertMayRemove, assertMayWrite, ensureRobotDirectory, expandPath, linkOnTheWay, resolvedPath } from './access.ts'
import type { HostDownloads } from './copy.ts'
import { errorCode } from './error-code.ts'
import type { FileChanges } from './file-change.ts'
import type { WorkspaceSessions } from './workspace-session.ts'

const MAX_READ = 10 * 1024 * 1024

export interface FileMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

/** A failure with an OS-style code (ENOENT, EISDIR, EFBIG) that the Worker shows after the message. */
const failure = (message: string, code: string): Error => Object.assign(new Error(message), { code })

/**
 * The files below a directory, depth first, as paths relative to it with / between the parts; the SKIPPED_DIRECTORIES are not entered,
 * and no symbolic link is followed or listed.
 */
export async function* filesBelow(directory: string, prefix = ''): AsyncGenerator<string> {
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

/** The repository root DSH would find for a directory (v1.21, cw-gx04): the nearest ancestor, the directory included, with a .git entry. */
export async function repositoryOf(directory: string): Promise<string | null> {
  for (let current = directory; ; current = dirname(current)) {
    if (await lstat(join(current, '.git')).then(() => true, () => false)) return current
    if (dirname(current) === current) return null
  }
}

export class HostDisk {
  private readonly home: string

  constructor(private readonly changes: FileChanges & { readonly sessions: WorkspaceSessions }, private readonly downloads: HostDownloads) {
    this.home = changes.home
  }

  /**
   * A path of a call as the app resolves it: a relative one starts in the Robot's current directory when the call names its Workspace
   * (access.cwd), else in the Robot's directory. A call that carries the Robot's Workspace opens its session (cw-p4bm).
   */
  private async full(access: HostAccess, path: string): Promise<string> {
    await this.changes.sessions.touch(access.robot, access.workspace)
    const directory = await ensureRobotDirectory(this.home, access)
    return expandPath(this.home, access.cwd ?? directory, path)
  }

  /**
   * The Robot's next current directory in its Workspace (cw-llvx): the directory `cd` names from the current one, with its links resolved,
   * inside the Workspace's repository.
   */
  async workingDirectory(access: HostAccess, cd: string): Promise<{ path: string }> {
    const workspace = access.workspace
    if (workspace === undefined) throw failure('This call names no Workspace: the Robot has none on this computer.', 'ENOENT')
    const target = await this.full(access, cd)
    const info = await stat(target).catch(() => undefined)
    if (info === undefined) throw failure(`${target} does not exist`, 'ENOENT')
    if (!info.isDirectory()) throw failure(`${target} is not a directory`, 'ENOTDIR')
    const real = await realpath(target)
    const repository = await realpath(workspace.repository)
    const from = relative(repository, real)
    if (from.startsWith('..') || isAbsolute(from)) throw failure(`${target} is outside the repository ${workspace.repository}; the current directory stays within it`, OUTSIDE_REPOSITORY)
    return { path: real }
  }

  /**
   * The directories in a directory, for the Workspace picker (cw-gx04): real directories only (no link), sorted, at most
   * LIST_DIRECTORY_MAX. A relative path or ~ starts in the home directory, not the Robot's: the owner picks among his own folders.
   */
  async listDirectory(path: string): Promise<{ path: string; directories: string[]; truncated: boolean }> {
    const full = expandPath(this.home, this.home, path)
    const entries = await readdir(full, { withFileTypes: true })
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    return { path: full, directories: directories.slice(0, LIST_DIRECTORY_MAX), truncated: directories.length > LIST_DIRECTORY_MAX }
  }

  /** What a path is, for a Workspace root (cw-gx04): its kind, the first link on the way and the repository root above it. */
  async stat(path: string): Promise<{ path: string; kind: 'directory' | 'file' | 'missing' | 'other'; link: string | null; repository: string | null }> {
    const full = expandPath(this.home, this.home, path)
    const info = await stat(full).catch((error: unknown) => {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return undefined
      throw error
    })
    const kind = info === undefined ? 'missing' : info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
    return { path: full, kind, link: (await linkOnTheWay(this.home, full)) ?? null, repository: kind === 'directory' ? await repositoryOf(full) : null }
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
      if (count > LISTING_MAX_FILES) return { paths: paths.sort(), truncated: true }
      const path = shown(base, below)
      if (matcher.test(path)) paths.push(path)
    }
    return { paths: paths.sort(), truncated: false }
  }

  /** At most GREP_MAX_MATCHES matches; `truncated` when there were more, or when the walk stopped at LISTING_MAX_FILES files. */
  async grep(access: HostAccess, input: { pattern: string; ignoreCase: boolean; glob?: string | undefined; path?: string | undefined }): Promise<{ matches: FileMatch[]; truncated: boolean }> {
    const regex = new RegExp(input.pattern, input.ignoreCase ? 'i' : '')
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const base = input.path ?? '.'
    const root = await this.full(access, base)
    const matches: FileMatch[] = []
    let truncated = false
    const search = async (full: string, path: string): Promise<void> => {
      if (files !== undefined && !files.test(path)) return
      if ((await stat(full)).size > GREP_MAX_FILE_BYTES) return
      const text = await readFile(full, 'utf8').catch(() => undefined)
      if (text === undefined || text.includes('\u0000')) return
      for (const [index, line] of text.split('\n').entries()) {
        if (!regex.test(line)) continue
        if (matches.length >= GREP_MAX_MATCHES) {
          truncated = true
          return
        }
        matches.push({ path, line: index + 1, text: line.slice(0, GREP_MAX_LINE) })
      }
    }
    if ((await stat(root)).isFile()) {
      await search(root, base)
      return { matches, truncated }
    }
    let count = 0
    for await (const below of filesBelow(root)) {
      count += 1
      if (count > LISTING_MAX_FILES) return { matches, truncated: true }
      await search(join(root, below), shown(base, below))
      if (truncated) break
    }
    return { matches, truncated }
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
