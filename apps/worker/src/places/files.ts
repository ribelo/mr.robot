/**
 * A filesystem backend per place (v1.16 ticket 01): the file tools say what to do, a backend does it where the file is. The Workspace
 * is R2 with the owner's Member files and the product docs mounted read-only; the Box is its container's disk; a Host is its
 * computer, reached with the Host's file RPCs (read, write, glob, grep, delete), done by the app in Node under the files facet.
 */
import { ALL_DOCS, docsReadOnlyMessage, isDocsPath, productDoc } from '../docs/index.ts'
import { MEMBER_FILE_NAMES, type MemberFileName } from '../member/member.ts'
import type { BoxBackend } from '../box/backend.ts'
import type { WorkspaceHost } from '../agent/host.ts'
import { normalizePath } from '../workspace/workspace.ts'
import { BadPath, FileTooLarge, MissingFile, ReadOnlyPath } from './errors.ts'
import { globToRegExp, GREP_MAX_MATCHES, skipped } from '@mr-robot/host-protocol'
import { grepText, type GrepMatch } from './file-ops.ts'
import { refuseOwned } from './place.ts'

export const WORKSPACE_ROOT = '/workspace'
export const BOX_ROOT = '/workspace'

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

export interface PlaceFiles {
  /** How errors name the place: "your Workspace", "your Box", "Desk". */
  readonly label: string
  readFile(path: string): Promise<FileContent>
  writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ readonly path: string; readonly bytes: number }>
  removeFile(path: string): Promise<{ readonly path: string }>
  glob(pattern: string): Promise<string[]>
  grep(input: GrepInput): Promise<GrepMatch[]>
}

const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_GREP_FILE_BYTES = 1_000_000
const MAX_GREP_FILES = 500

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
  return key
}

/** The bytes of a file the platform owns (an owner's file or a doc), which are text kept in the Worker and not in R2; undefined for any other key. */
export async function ownedBytes(host: WorkspaceHost, key: string): Promise<Uint8Array | undefined> {
  const member = memberName(key)
  if (member !== undefined) return new TextEncoder().encode(await host.memberFile(member))
  if (!isDocsPath(key)) return undefined
  const doc = productDoc(key)
  if (doc === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `${WORKSPACE_ROOT}/${key} does not exist` })
  return new TextEncoder().encode(doc.text)
}

/** A file's text when it is text; undefined for a binary file, one with a NUL, or one that cannot be read. */
function searchableText(read: FileContent | undefined): string | undefined {
  return read === undefined || !('text' in read) || read.text.includes('\u0000') ? undefined : read.text
}

/** The matches of a regular expression over the files at `paths`, read one by one; stops at the match limit and at MAX_GREP_FILES files. */
async function grepFiles(paths: readonly string[], readOne: (path: string) => Promise<FileContent | undefined>, regex: RegExp): Promise<GrepMatch[]> {
  const matches: GrepMatch[] = []
  for (const path of paths.slice(0, MAX_GREP_FILES)) {
    if (matches.length >= GREP_MAX_MATCHES) break
    const text = searchableText(await readOne(path))
    if (text !== undefined) matches.push(...grepText(path, text, regex, GREP_MAX_MATCHES - matches.length))
  }
  return matches
}

export class WorkspaceFiles implements PlaceFiles {
  readonly label = 'your Workspace'

  constructor(private readonly host: WorkspaceHost) {}

  async readFile(path: string): Promise<FileContent> {
    const key = workspaceKey(path)
    const display = `${WORKSPACE_ROOT}/${key}`
    const member = memberName(key)
    if (member !== undefined) return { path: display, text: await this.host.memberFile(member) }
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
    const body = encoding === 'base64' ? bytesOfBase64(content) : content
    await this.host.run(this.host.workspace.write(key, body))
    return { path: `${WORKSPACE_ROOT}/${key}`, bytes: typeof body === 'string' ? new TextEncoder().encode(body).length : body.length }
  }

  async removeFile(path: string): Promise<{ path: string }> {
    const key = writableWorkspaceKey(path)
    if ((await this.host.run(this.host.workspace.stat(key))) === undefined) throw new MissingFile({ place: this.label, path: key, message: `No file "${key}" in your Workspace; nothing was deleted.` })
    await this.host.run(this.host.workspace.remove(key))
    return { path: key }
  }

  /** The paths of the Workspace a search or a listing sees: the owner's files, the docs and the objects of R2 (not the docs the bucket might hold). */
  private async visible(maxBytes?: number): Promise<string[]> {
    const entries = await this.host.run(this.host.workspace.list())
    return [...MEMBER_FILE_NAMES, ...DOCS_PATHS, ...stored(entries).filter((entry) => maxBytes === undefined || entry.size <= maxBytes).map((entry) => entry.path)]
  }

  async glob(pattern: string): Promise<string[]> {
    const matcher = globToRegExp(pattern.replace(/^\/workspace\//, ''))
    return (await this.visible()).filter((path) => matcher.test(path)).sort()
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
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

  /** Every file of the Box with its path relative to /workspace, without the platform's own job files and without .git and node_modules. */
  private async listing(backend: BoxBackend): Promise<ReadonlyArray<{ path: string; size: number }>> {
    return (await backend.list(BOX_ROOT)).filter((file) => !file.path.startsWith('.jobs/') && !skipped(file.path))
  }

  async glob(pattern: string): Promise<string[]> {
    const matcher = globToRegExp(pattern.replace(/^\/workspace\//, ''))
    return this.onBox(async (backend) => (await this.listing(backend)).map((file) => file.path).filter((path) => matcher.test(path)).sort())
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const under = input.path === undefined ? undefined : boxPath(input.path).slice(BOX_ROOT.length + 1)
    return this.onBox(async (backend) => {
      const paths = (await this.listing(backend))
        .filter((file) => file.size <= MAX_GREP_FILE_BYTES && (files === undefined || files.test(file.path)) && (under === undefined || file.path === under || file.path.startsWith(`${under}/`)))
        .map((file) => file.path)
      return grepFiles(paths, async (path) => {
        const bytes = await backend.read(`${BOX_ROOT}/${path}`)
        return bytes === null ? undefined : contentOf(path, bytes)
      }, regexOf(input))
    })
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
  grep(input: { pattern: string; ignoreCase: boolean; glob?: string; path?: string }): Promise<{ readonly matches: readonly GrepMatch[] }>
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

  async glob(pattern: string): Promise<string[]> {
    return [...(await this.link.glob(pattern)).paths]
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
    return [...(await this.link.grep({ pattern: input.pattern, ignoreCase: input.ignoreCase, ...(input.glob === undefined ? {} : { glob: input.glob }), ...(input.path === undefined ? {} : { path: input.path }) })).matches]
  }
}
