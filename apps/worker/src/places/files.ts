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
import { globToRegExp, grepText, MAX_GREP_MATCHES, skipped, type GrepMatch } from './file-ops.ts'
import { OWNED_ON_WORKSPACE, ownedPath } from './place.ts'

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

export class WorkspaceFiles implements PlaceFiles {
  readonly label = 'your Workspace'

  constructor(private readonly host: WorkspaceHost) {}

  private memberName(key: string): MemberFileName | undefined {
    return MEMBER_FILE_NAMES.find((name) => name === key)
  }

  /** The key of a path in the Workspace: relative, or under /workspace. */
  key(path: string): string {
    if (path.startsWith('/') && path !== WORKSPACE_ROOT && !path.startsWith(`${WORKSPACE_ROOT}/`)) throw new Error(`${path} is outside your Workspace (${WORKSPACE_ROOT})`)
    const key = normalizePath(path.replace(/^\/workspace\/?/, ''))
    if (key === undefined) throw new Error(/(^|[/\\])\.\.([/\\]|$)/.test(path) ? `${path} is outside your Workspace (${WORKSPACE_ROOT})` : `"${path}" is not a file path inside your Workspace`)
    return key
  }

  private writable(key: string): void {
    const member = this.memberName(key)
    if (member !== undefined) throw new Error(READ_ONLY_MEMBER(member))
    if (isDocsPath(key)) throw new Error(docsReadOnlyMessage(key))
  }

  /** The key of a path the Robot may write: not an owner's file and not under docs/. */
  writableKey(path: string): string {
    const key = this.key(path)
    this.writable(key)
    return key
  }

  /** A file whole as bytes (a copy's source); the owner's files and the docs are text. */
  async readFileBytes(key: string, maxBytes: number): Promise<Uint8Array> {
    const member = this.memberName(key)
    if (member !== undefined) return new TextEncoder().encode(await this.host.memberFile(member))
    if (isDocsPath(key)) {
      const doc = productDoc(key)
      if (doc === undefined) throw new Error(`${WORKSPACE_ROOT}/${key} does not exist`)
      return new TextEncoder().encode(doc.text)
    }
    const entry = await this.host.run(this.host.workspace.stat(key))
    if (entry === undefined) throw new Error(`${WORKSPACE_ROOT}/${key} does not exist`)
    if (entry.size > maxBytes) throw new Error(`${WORKSPACE_ROOT}/${key} is ${entry.size} bytes; this copy is limited to ${maxBytes / 1024 / 1024} MB for now.`)
    const file = await this.host.run(this.host.workspace.read(key))
    if (file === undefined) throw new Error(`${WORKSPACE_ROOT}/${key} does not exist`)
    return new Uint8Array(file.body)
  }

  async readFile(path: string): Promise<FileContent> {
    const key = this.key(path)
    const display = `${WORKSPACE_ROOT}/${key}`
    const member = this.memberName(key)
    if (member !== undefined) return { path: display, text: await this.host.memberFile(member) }
    if (isDocsPath(key)) {
      const doc = productDoc(key)
      if (doc === undefined) throw new Error(`${display} does not exist`)
      return { path: display, text: doc.text }
    }
    const entry = await this.host.run(this.host.workspace.stat(key))
    if (entry === undefined) throw new Error(`${display} does not exist`)
    if (entry.size > MAX_READ_BYTES) throw new Error(`${display} is ${entry.size} bytes; read opens files up to ${MAX_READ_BYTES / 1024 / 1024} MB. Use grep, or copy it to your Box and work on it there.`)
    const file = await this.host.run(this.host.workspace.read(key))
    if (file === undefined) throw new Error(`${display} does not exist`)
    return contentOf(display, new Uint8Array(file.body))
  }

  async writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ path: string; bytes: number }> {
    const key = this.key(path)
    this.writable(key)
    const body = encoding === 'base64' ? bytesOfBase64(content) : content
    await this.host.run(this.host.workspace.write(key, body))
    return { path: `${WORKSPACE_ROOT}/${key}`, bytes: typeof body === 'string' ? new TextEncoder().encode(body).length : body.length }
  }

  async removeFile(path: string): Promise<{ path: string }> {
    const key = this.key(path)
    this.writable(key)
    if ((await this.host.run(this.host.workspace.stat(key))) === undefined) throw new Error(`No file "${key}" in your Workspace; nothing was deleted.`)
    await this.host.run(this.host.workspace.remove(key))
    return { path: key }
  }

  async glob(pattern: string): Promise<string[]> {
    const matcher = globToRegExp(pattern.replace(/^\/workspace\//, ''))
    const entries = await this.host.run(this.host.workspace.list())
    return [...MEMBER_FILE_NAMES, ...DOCS_PATHS, ...stored(entries).map((entry) => entry.path)].filter((path) => matcher.test(path)).sort()
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
    const regex = regexOf(input)
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const under = input.path === undefined ? undefined : this.key(input.path)
    const entries = await this.host.run(this.host.workspace.list())
    const paths = [...MEMBER_FILE_NAMES, ...DOCS_PATHS, ...stored(entries).filter((entry) => entry.size <= MAX_GREP_FILE_BYTES).map((entry) => entry.path)]
      .filter((path) => (files === undefined || files.test(path)) && (under === undefined || path === under || path.startsWith(`${under}/`)))
    const matches: GrepMatch[] = []
    for (const path of paths) {
      if (matches.length >= MAX_GREP_MATCHES) break
      const read = await this.readFile(path).catch(() => undefined)
      if (read === undefined || !('text' in read) || read.text.includes('\u0000')) continue
      matches.push(...grepText(path, read.text, regex, MAX_GREP_MATCHES - matches.length))
    }
    return matches
  }
}

// ---------------------------------------------------------------- the Box

/** What a Box backend needs of the Robot around it: booted when it is not up, and told that it was used (the idle stop counts from there). */
export interface BoxAccess {
  boot(): Promise<BoxBackend>
  touch(): Promise<void>
}

/** A path on the Box: relative to its /workspace, or under it. */
export function boxPath(path: string): string {
  const relative = path.startsWith(`${BOX_ROOT}/`) ? path.slice(BOX_ROOT.length + 1) : path.startsWith('/') ? undefined : path
  const normalized = relative === undefined ? undefined : normalizePath(relative)
  if (normalized === undefined) throw new Error(`${path} is outside your Box's ${BOX_ROOT}`)
  return `${BOX_ROOT}/${normalized}`
}

const refuseOwned = (path: string): void => {
  if (ownedPath(path)) throw new Error(OWNED_ON_WORKSPACE(path))
}

export class BoxFiles implements PlaceFiles {
  readonly label = 'your Box'

  constructor(private readonly box: BoxAccess) {}

  private async used<A>(action: (backend: BoxBackend) => Promise<A>): Promise<A> {
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
    return this.used(async (backend) => {
      const bytes = await backend.read(target)
      if (bytes === null) throw new Error(`${target} does not exist on your Box`)
      return contentOf(target, bytes)
    })
  }

  async writeFile(path: string, content: string, encoding: 'text' | 'base64'): Promise<{ path: string; bytes: number }> {
    refuseOwned(path)
    const target = boxPath(path)
    const bytes = encoding === 'base64' ? bytesOfBase64(content) : new TextEncoder().encode(content)
    return this.used(async (backend) => {
      await backend.write(target, bytes)
      return { path: target, bytes: bytes.byteLength }
    })
  }

  async removeFile(path: string): Promise<{ path: string }> {
    refuseOwned(path)
    const target = boxPath(path)
    return this.used(async (backend) => {
      if ((await backend.read(target)) === null) throw new Error(`No file ${target} on your Box; nothing was deleted.`)
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
    return this.used(async (backend) => (await this.listing(backend)).map((file) => file.path).filter((path) => matcher.test(path)).sort())
  }

  async grep(input: GrepInput): Promise<GrepMatch[]> {
    const regex = regexOf(input)
    const files = input.glob === undefined ? undefined : globToRegExp(input.glob)
    const under = input.path === undefined ? undefined : boxPath(input.path).slice(BOX_ROOT.length + 1)
    return this.used(async (backend) => {
      const paths = (await this.listing(backend))
        .filter((file) => file.size <= MAX_GREP_FILE_BYTES && (files === undefined || files.test(file.path)) && (under === undefined || file.path === under || file.path.startsWith(`${under}/`)))
        .slice(0, MAX_GREP_FILES)
      const matches: GrepMatch[] = []
      for (const { path } of paths) {
        if (matches.length >= MAX_GREP_MATCHES) break
        const bytes = await backend.read(`${BOX_ROOT}/${path}`)
        const read = bytes === null ? undefined : contentOf(path, bytes)
        if (read === undefined || !('text' in read) || read.text.includes('\u0000')) continue
        matches.push(...grepText(path, read.text, regex, MAX_GREP_MATCHES - matches.length))
      }
      return matches
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
const refuseOwnedOnHost = (path: string): void => {
  if (!path.startsWith('/') && ownedPath(path)) throw new Error(OWNED_ON_WORKSPACE(path))
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
