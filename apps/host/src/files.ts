/**
 * The files of this computer for a Robot (v1.2, v1.16 ticket 02): read, write, list, search and delete in Node, so file tools work the
 * same on every OS and do not depend on a shell. Relative paths start in the Robot's directory; reads are as wide as the OS user;
 * every write obeys the grant's mode and roots (access.ts).
 */
import { lstat, mkdir, open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { globBase, globToRegExp, GREP_MAX_FILE_BYTES, GREP_MAX_LINE, GREP_MAX_MATCHES, SKIPPED_DIRECTORIES, type HostAccess } from '@mr-robot/host-protocol'
import { assertMayWrite, ensureRobotDirectory, expandPath } from './access.ts'

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
      if (!(SKIPPED_DIRECTORIES as readonly string[]).includes(entry.name)) yield* filesBelow(join(directory, entry.name), `${prefix}${entry.name}/`)
    } else if (entry.isFile()) {
      yield `${prefix}${entry.name}`
    }
  }
}

/** A path as the Robot sees it in a listing: the base as it gave it, then the path below. */
const shown = (base: string, below: string): string => (base === '.' ? below : base.endsWith('/') ? `${base}${below}` : `${base}/${below}`)

export class HostDisk {
  constructor(private readonly home: string = homedir()) {}

  private async full(access: HostAccess, path: string): Promise<string> {
    return expandPath(this.home, await ensureRobotDirectory(this.home, access), path)
  }

  async read(access: HostAccess, path: string) {
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

  async write(access: HostAccess, path: string, input: { text?: string | undefined; base64?: string | undefined }) {
    const full = await this.full(access, path)
    await assertMayWrite(this.home, access, full)
    const body = input.base64 !== undefined ? Buffer.from(input.base64, 'base64') : Buffer.from(input.text ?? '', 'utf8')
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, body)
    return { path: full, bytes: body.length }
  }

  async readChunk(access: HostAccess, path: string, offset: number, length: number) {
    const full = await this.full(access, path)
    const info = await stat(full)
    const handle = await open(full, 'r')
    try {
      const wanted = Math.max(0, Math.min(length, info.size - offset))
      const buffer = Buffer.alloc(wanted)
      const { bytesRead } = await handle.read(buffer, 0, wanted, offset)
      return { path: full, size: info.size, base64: buffer.subarray(0, bytesRead).toString('base64') }
    } finally {
      await handle.close()
    }
  }

  /** One piece at an offset; the piece at offset 0 starts the file afresh and creates its directories. */
  async writeChunk(access: HostAccess, path: string, offset: number, base64: string) {
    const full = await this.full(access, path)
    await assertMayWrite(this.home, access, full)
    const body = Buffer.from(base64, 'base64')
    if (offset === 0) {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, body)
    } else {
      const handle = await open(full, 'r+')
      try {
        await handle.write(body, 0, body.length, offset)
      } finally {
        await handle.close()
      }
    }
    return { path: full, bytes: body.length }
  }

  async glob(access: HostAccess, pattern: string) {
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

  async remove(access: HostAccess, path: string) {
    const full = await this.full(access, path)
    await assertMayWrite(this.home, access, full)
    const info = await lstat(full).catch(() => undefined)
    if (info === undefined) throw failure(`No file ${full}; nothing was deleted.`, 'ENOENT')
    if (!info.isFile() && !info.isSymbolicLink()) throw failure(`${full} is not a file; only files are deleted.`, 'EISDIR')
    await unlink(full)
    return { path: full }
  }
}
