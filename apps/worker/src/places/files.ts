/**
 * A filesystem backend per place (v1.16 ticket 01): the file tools say what to do, a backend does it where the file is. The Workspace
 * is R2 with the owner's Member files and the product docs mounted read-only; the Box is its container's disk; a Host is its
 * computer, reached with the Host's file RPCs (read, write, glob, grep, delete), done by the app in Node under the files facet.
 */
import { ALL_DOCS, docsReadOnlyMessage, isDocsPath, productDoc } from '../docs/index.ts'
import { MEMBER_FILE_NAMES, type MemberFileName } from '../member/member.ts'
import { isPeoplePage, isPeoplePath } from '../member/people.ts'
import type { BoxBackend } from '../box/backend.ts'
import type { WorkspaceHost } from '../agent/host.ts'
import { normalizePath } from '../workspace/workspace.ts'
import { BadCall, BadPath, FileTooLarge, MissingFile, ReadOnlyPath } from './errors.ts'
import { globBase, globToRegExp, GREP_MAX_MATCHES } from '@mr-robot/host-protocol'
import { grepText, type GrepMatch } from './file-ops.ts'
import { refuseOwned } from './place.ts'

export const WORKSPACE_ROOT = '/workspace'
export const BOX_ROOT = '/workspace'
/** Where a copy between two places other than the Workspace parks its file (places.ts): tmp/<id>/ in the Workspace. */
export const STAGING_DIRECTORY = 'tmp'

/** A file read: its text, or base64 when it is not UTF-8. */
export type FileContent =
  | { readonly path: string; readonly text: string }
  | { readonly path: string; readonly size: number; readonly base64: string }

export interface GrepInput {
  readonly pattern: string
  readonly glob?: string
  readonly ignoreCase: boolean
  /** A directory to search; the place's own root when left out. */
  readonly path?: string
}

/** The paths a glob matched, sorted; `truncated` when the place stopped listing early, so some matches may be missing (deep review P15). */
export interface FileListing {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

/** At most GREP_MAX_MATCHES matches; `truncated` when there were more, or when the place did not search every file (deep review P15). */
export interface GrepResult {
  readonly matches: readonly GrepMatch[]
  readonly truncated: boolean
}

export interface PlaceFiles {
  /** How errors name the place: "your Workspace", "your Box", "Desk". */
  readonly label: string
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ readonly path: string; readonly bytes: number }>
  removeFile(path: string): Promise<{ readonly path: string }>
  glob(pattern: string): Promise<FileListing>
  grep(input: GrepInput): Promise<GrepResult>
}

const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_GREP_FILE_BYTES = 1_000_000
/** The most Workspace files one grep reads: each is an R2 read from the Worker. */
export const WORKSPACE_GREP_MAX_FILES = 500

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

/** Bytes as text when they are UTF-8, else base64. */
export function contentOf(path: string, bytes: Uint8Array): FileContent {
  try {
    return { path, text: decoder.decode(bytes) }
  } catch {
    let binary = ''
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
    return { path, size: bytes.length, base64: btoa(binary) }
  }
}

export function bytesOfBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

const regexOf = (input: GrepInput): RegExp => new RegExp(input.pattern, input.ignoreCase ? 'i' : '')

// ---------------------------------------------------------------- the Workspace

const READ_ONLY_MEMBER = (name: string) => `${name} belongs to your owner and is read-only to you. To change it, use the tool you were given for shared files: memory_write_shared, or propose_member_file_edit (your owner approves or rejects the new full content).`

const DOCS_PATHS = ALL_DOCS.map((entry) => entry.path)
/** Stored entries without anything under docs/: the platform's docs come from the bundle only. */
const stored = <T extends { path: string }>(entries: readonly T[]): T[] => entries.filter((entry) => !isDocsPath(entry.path))

const memberName = (key: string): MemberFileName | undefined => MEMBER_FILE_NAMES.find((name) => name === key)
const PEOPLE_READ_ONLY = (path: string) => `${path} is kept by the platform and read-only. Write a page as memory/people/<name>.md: your owner's Robots write people pages directly.`

/** The key of a path in the Workspace: relative, or under /workspace. @throws BadPath when the path is not a file path inside the Workspace. */
export function workspaceKey(path: string): string {
  if (path.startsWith('/') && path !== WORKSPACE_ROOT && !path.startsWith(`${WORKSPACE_ROOT}/`)) throw new BadPath({ path, message: `${path} is outside your Workspace (${WORKSPACE_ROOT})` })
  const key = normalizePath(path.replace(/^\/workspace\/?/, ''))
  if (key === undefined) throw new BadPath({ path, message: /(^|[/\\])\.\.([/\\]|$)/.test(path) ? `${path} is outside your Workspace (${WORKSPACE_ROOT})` : `"${path}" is not a file path inside your Workspace` })
  return key
}

/** The key of a path the Robot may write: not an owner's file and not under docs/. @throws ReadOnlyPath for those, BadPath for a bad path. */
export function writableWorkspaceKey(path: string): string {
  const key = workspaceKey(path)
  const member = memberName(key)
  if (member !== undefined) throw new ReadOnlyPath({ path: key, message: READ_ONLY_MEMBER(member) })
  if (isDocsPath(key)) throw new ReadOnlyPath({ path: key, message: docsReadOnlyMessage(key) })
  // Under memory/people/ only a page is written, and to the owner's Member files, not to R2 (v1.20, dm-s0gy).
  if (key.startsWith('memory/people/') && !isPeoplePage(key)) throw new ReadOnlyPath({ path: key, message: PEOPLE_READ_ONLY(key) })
  return key
}

/** The bytes of a file the platform owns (an owner's file or a doc), which are text kept in the Worker and not in R2; undefined for any other key. */
export async function ownedBytes(host: WorkspaceHost, key: string): Promise<Uint8Array | undefined> {
  const member = memberName(key)
  if (member !== undefined) return new TextEncoder().encode(await host.memberFile(member))
  if (isPeoplePath(key)) {
    const text = await host.peopleFile(key)
    if (text === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `${WORKSPACE_ROOT}/${key} does not exist` })
    return new TextEncoder().encode(text)
  }
  if (!isDocsPath(key)) return undefined
  const doc = productDoc(key)
  if (doc === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `${WORKSPACE_ROOT}/${key} does not exist` })
  return new TextEncoder().encode(doc.text)
}

/** A file's text when it is text; undefined for a binary file, one with a NUL, or one that cannot be read. */
function searchableText(read: FileContent | undefined): string | undefined {
  return read === undefined || !('text' in read) || read.text.includes('\u0000') ? undefined : read.text
}

/** The matches of a regular expression over the files at `paths`, read one by one; truncated past the match limit or WORKSPACE_GREP_MAX_FILES files. */
async function grepFiles(paths: readonly string[], readOne: (path: string) => Promise<FileContent | undefined>, regex: RegExp): Promise<GrepResult> {
  const matches: GrepMatch[] = []
  for (const path of paths.slice(0, WORKSPACE_GREP_MAX_FILES)) {
    const text = searchableText(await readOne(path))
    // One match past the limit is asked for, to know that there are more.
    if (text !== undefined) matches.push(...grepText(path, text, regex, GREP_MAX_MATCHES + 1 - matches.length))
    if (matches.length > GREP_MAX_MATCHES) return { matches: matches.slice(0, GREP_MAX_MATCHES), truncated: true }
  }
  return { matches, truncated: paths.length > WORKSPACE_GREP_MAX_FILES }
}

export class WorkspaceFiles implements PlaceFiles {
  readonly label = 'your Workspace'

  constructor(private readonly host: WorkspaceHost) {}

  async readFile(path: string): Promise<FileContent> {
    const key = workspaceKey(path)
    const display = `${WORKSPACE_ROOT}/${key}`
    const member = memberName(key)
    if (member !== undefined) return { path: display, text: await this.host.memberFile(member) }
    if (isPeoplePath(key)) {
      const text = await this.host.peopleFile(key)
      if (text === undefined) throw new MissingFile({ place: this.label, path: display, message: `${display} does not exist. Make the page with write; memory/people/_template.md is its shape.` })
      return { path: display, text }
    }
    if (isDocsPath(key)) {
      const doc = productDoc(key)
      if (doc === undefined) throw new MissingFile({ place: this.label, path: display, message: `${display} does not exist` })
      return { path: display, text: doc.text }
    }
    const entry = await this.host.run(this.host.workspace.stat(key))
    if (entry === undefined) throw new MissingFile({ place: this.label, path: display, message: `${display} does not exist` })
    if (entry.size > MAX_READ_BYTES) throw new FileTooLarge({ path: display, size: entry.size, message: `${display} is ${entry.size} bytes; read opens files up to ${MAX_READ_BYTES / 1024 / 1024} MB. Use grep, or copy it to your Box and work on it there.` })
    const file = await this.host.run(this.host.workspace.read(key))
    if (file === undefined) throw new MissingFile({ place: this.label, path: display, message: `${display} does not exist` })
    return contentOf(display, new Uint8Array(file.body))
  }

  async writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ path: string; bytes: number }> {
    const key = writableWorkspaceKey(path)
    if (isPeoplePage(key)) {
      if (encoding !== 'text') throw new BadCall({ tool: 'write', message: 'a people page is text' })
      await this.host.writePeoplePage(key, content)
      return { path: `${WORKSPACE_ROOT}/${key}`, bytes: new TextEncoder().encode(content).length }
    }
    const body = encoding === 'base64' ? bytesOfBase64(content) : content
    await this.host.run(this.host.workspace.write(key, body))
    return { path: `${WORKSPACE_ROOT}/${key}`, bytes: typeof body === 'string' ? new TextEncoder().encode(body).length : body.length }
  }

  async removeFile(path: string): Promise<{ path: string }> {
    const key = writableWorkspaceKey(path)
    if (isPeoplePage(key)) {
      if ((await this.host.peopleFile(key)) === undefined) throw new MissingFile({ place: this.label, path: key, message: `No people page "${key}"; nothing was deleted.` })
      await this.host.removePeoplePage(key).catch((error: unknown) => { throw new ReadOnlyPath({ path: key, message: error instanceof Error ? error.message : String(error) }) })
      return { path: key }
    }
    if ((await this.host.run(this.host.workspace.stat(key))) === undefined) throw new MissingFile({ place: this.label, path: key, message: `No file "${key}" in your Workspace; nothing was deleted.` })
    await this.host.run(this.host.workspace.remove(key))
    return { path: key }
  }

  /** The paths of the Workspace a search or a listing sees: the owner's files, the docs and the objects of R2 (not the docs the bucket might hold). */
  private async visible(maxBytes?: number): Promise<string[]> {
    const entries = await this.host.run(this.host.workspace.list())
    return [...MEMBER_FILE_NAMES, ...(await this.host.peoplePaths()), ...DOCS_PATHS, ...stored(entries).filter((entry) => !entry.path.startsWith('memory/people/')).filter((entry) => maxBytes === undefined || entry.size <= maxBytes).map((entry) => entry.path)]
  }

  /** Every stored path is listed: never truncated. */
  async glob(pattern: string): Promise<FileListing> {
    const matcher = globToRegExp(pattern.replace(/^\/workspace\//, ''))
    return { paths: (await this.visible()).filter((path) => matcher.test(path)).sort(), truncated: false }
  }

  async grep(input: GrepInput): Promise<GrepResult> {
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const under = input.path === undefined ? undefined : workspaceKey(input.path)
    const paths = (await this.visible(MAX_GREP_FILE_BYTES)).filter((path) => (files === undefined || files.test(path)) && (under === undefined || path === under || path.startsWith(`${under}/`)))
    return grepFiles(paths, (path) => this.readFile(path).catch(() => undefined), regexOf(input))
  }
}

// ---------------------------------------------------------------- the Box

/** What a Box backend needs of the Robot around it: booted when it is not up, and told that it was used (the idle stop counts from there). */
export interface BoxAccess {
  boot(): Promise<BoxBackend>
  touch(): Promise<void>
}

/** A path on the Box: relative to its /workspace, or under it. @throws BadPath when it leaves /workspace. */
export function boxPath(path: string): string {
  const relative = path.startsWith(`${BOX_ROOT}/`) ? path.slice(BOX_ROOT.length + 1) : path.startsWith('/') ? undefined : path
  const normalized = relative === undefined ? undefined : normalizePath(relative)
  if (normalized === undefined) throw new BadPath({ path, message: `${path} is outside your Box's ${BOX_ROOT}` })
  return `${BOX_ROOT}/${normalized}`
}

export class BoxFiles implements PlaceFiles {
  readonly label = 'your Box'

  constructor(private readonly box: BoxAccess) {}

  /** Run `action` on the booted Box and tell the Robot the Box was used. */
  private async onBox<A>(action: (backend: BoxBackend) => Promise<A>): Promise<A> {
    const backend = await this.box.boot()
    try {
      return await action(backend)
    } finally {
      await this.box.touch()
    }
  }

  async readFile(path: string): Promise<FileContent> {
    refuseOwned(path)
    const target = boxPath(path)
    return this.onBox(async (backend) => {
      const bytes = await backend.read(target)
      if (bytes === null) throw new MissingFile({ place: this.label, path: target, message: `${target} does not exist on your Box` })
      return contentOf(target, bytes)
    })
  }

  async writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ path: string; bytes: number }> {
    refuseOwned(path)
    const target = boxPath(path)
    const bytes = encoding === 'base64' ? bytesOfBase64(content) : new TextEncoder().encode(content)
    return this.onBox(async (backend) => {
      await backend.write(target, bytes)
      return { path: target, bytes: bytes.byteLength }
    })
  }

  async removeFile(path: string): Promise<{ path: string }> {
    refuseOwned(path)
    const target = boxPath(path)
    return this.onBox(async (backend) => {
      if ((await backend.read(target)) === null) throw new MissingFile({ place: this.label, path: target, message: `No file ${target} on your Box; nothing was deleted.` })
      await backend.remove(target)
      return { path: target }
    })
  }

  /** ripgrep lists the files under the directory before the pattern's first wildcard (box-search.ts); the pattern picks from them. */
  async glob(pattern: string): Promise<FileListing> {
    const relative = pattern.replace(/^\/workspace\//, '')
    const base = globBase(relative)
    const under = base === '.' ? undefined : boxPath(base).slice(BOX_ROOT.length + 1)
    const matcher = globToRegExp(relative)
    return this.onBox(async (backend) => {
      const listed = await backend.files(under)
      return { paths: listed.paths.filter((path) => matcher.test(path)).sort(), truncated: listed.truncated }
    })
  }

  /** ripgrep searches on the Box (box-search.ts), so the pattern is ripgrep's; a pattern it refuses is a BadCall. */
  async grep(input: GrepInput): Promise<GrepResult> {
    const under = input.path === undefined ? undefined : boxPath(input.path).slice(BOX_ROOT.length + 1)
    const found = await this.onBox((backend) => backend.grep({ pattern: input.pattern, ignoreCase: input.ignoreCase, ...(input.glob === undefined ? {} : { glob: input.glob }), ...(under === undefined ? {} : { under }) }))
    if (found._tag === 'BadPattern') throw new BadCall({ tool: 'grep', message: `grep on your Box refused the pattern: ${found.message}` })
    return { matches: [...found.matches].sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1)), truncated: found.truncated }
  }
}

// ---------------------------------------------------------------- a Host

/** What a Host backend needs of one Host: the file RPCs, all under the Robot's files facet and failing as the Host calls fail. */
export interface HostFileLink {
  readonly name: string
  read(path: string): Promise<{ readonly path: string; readonly size: number; readonly text: string | null; readonly base64: string | null }>
  write(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ readonly path: string; readonly bytes: number }>
  /** The files a glob matches, listed by the app in Node. */
  glob(pattern: string): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }>
  grep(input: { pattern: string; ignoreCase: boolean; glob?: string; path?: string }): Promise<{ readonly matches: readonly GrepMatch[]; readonly truncated: boolean }>
  remove(path: string): Promise<{ readonly path: string }>
}

/** A relative path on a Host starts in the Robot's directory there; the Workspace's own names are not a Host's. */
export const refuseOwnedOnHost = (path: string): void => {
  if (!path.startsWith('/')) refuseOwned(path)
}

export class HostFiles implements PlaceFiles {
  readonly label: string

  constructor(private readonly link: HostFileLink) {
    this.label = link.name
  }

  async readFile(path: string): Promise<FileContent> {
    refuseOwnedOnHost(path)
    const read = await this.link.read(path)
    return read.text !== null ? { path: read.path, text: read.text } : { path: read.path, size: read.size, base64: read.base64 ?? '' }
  }

  async writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ path: string; bytes: number }> {
    refuseOwnedOnHost(path)
    return this.link.write(path, content, encoding)
  }

  async removeFile(path: string): Promise<{ path: string }> {
    refuseOwnedOnHost(path)
    return this.link.remove(path)
  }

  async glob(pattern: string): Promise<FileListing> {
    const listed = await this.link.glob(pattern)
    return { paths: listed.paths, truncated: listed.truncated }
  }

  async grep(input: GrepInput): Promise<GrepResult> {
    const found = await this.link.grep({ pattern: input.pattern, ignoreCase: input.ignoreCase, ...(input.glob === undefined ? {} : { glob: input.glob }), ...(input.path === undefined ? {} : { path: input.path }) })
    return { matches: found.matches, truncated: found.truncated }
  }
}