/**
 * The DSH fs seam over the Robot's R2 Workspace (robot-8pqy): DSH's read, write and edit tools
 * work on /workspace, which is the Robot's R2 prefix. The owner's Member files appear at the
 * root read-only; writing them is refused with a pointer to propose_member_file_edit.
 * A thin Cordis adapter: every operation is the Workspace Effect service run to a promise.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  FileSystem,
  FsError,
  FsTargetKey,
  FsVersion,
  type FsDirEntry,
  type FsEditOutcome,
  type FsEditRequest,
  type FsInfo,
  type FsPathInfo,
  type FsTarget,
  type FsWriteIntent,
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import * as Effect from 'effect/Effect'
import { MEMBER_FILE_NAMES, type MemberFileName } from '../member/member.ts'
import { normalizePath, type WorkspaceShape } from './workspace.ts'

export const WORKSPACE_ROOT = '/workspace'

export interface R2FileSystemConfig {
  readonly workspace: WorkspaceShape
  readonly memberFile: (name: MemberFileName) => Promise<string>
}

const target = (key: string): FsTarget => ({ targetKey: FsTargetKey(key), displayPath: key === '' ? WORKSPACE_ROOT : `${WORKSPACE_ROOT}/${key}` })
const memberFile = (key: string): MemberFileName | undefined => MEMBER_FILE_NAMES.find((name) => name === key)

async function contentVersion(text: string): Promise<FsVersion> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return FsVersion(`m-${[...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`)
}

export class R2FileSystem extends FileSystem {
  private readonly workspace: WorkspaceShape
  private readonly member: (name: MemberFileName) => Promise<string>

  constructor(ctx: Context, config: R2FileSystemConfig) {
    super(ctx)
    this.workspace = config.workspace
    this.member = config.memberFile
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(effect.pipe(Effect.mapError((error) => new FsError(String((error as { message?: unknown }).message ?? error), 'FS_IO_ERROR'))))
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget> {
    const base = opts?.cwd ?? WORKSPACE_ROOT
    const absolute = path.startsWith('/') ? path : `${base}/${path}`
    if (absolute === WORKSPACE_ROOT || absolute === `${WORKSPACE_ROOT}/`) return target('')
    if (!absolute.startsWith(`${WORKSPACE_ROOT}/`)) throw new FsError(`${path} is outside your Workspace (${WORKSPACE_ROOT})`, 'FS_PERMISSION_DENIED')
    const key = normalizePath(absolute.slice(WORKSPACE_ROOT.length + 1))
    if (key === undefined) {
      if (/^[/.]*$/.test(absolute.slice(WORKSPACE_ROOT.length + 1))) return target('')
      throw new FsError(`${path} is outside your Workspace (${WORKSPACE_ROOT})`, 'FS_PERMISSION_DENIED')
    }
    return target(key)
  }

  processPath(fsTarget: FsTarget): string {
    return fsTarget.displayPath
  }

  fileUrl(fsTarget: FsTarget): string {
    return `workspace:${fsTarget.displayPath}`
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    const p = String(parent.targetKey)
    const c = String(child.targetKey)
    return p === '' || c === p || c.startsWith(`${p}/`)
  }

  async stat(fsTarget: FsTarget): Promise<FsInfo | undefined> {
    const key = String(fsTarget.targetKey)
    if (key === '') return { version: FsVersion('root'), type: 'directory' }
    const member = memberFile(key)
    if (member !== undefined) {
      const text = await this.member(member)
      return { version: await contentVersion(text), type: 'file', size: new TextEncoder().encode(text).length }
    }
    const entry = await this.run(this.workspace.stat(key))
    if (entry !== undefined) return { version: FsVersion(entry.etag), type: 'file', size: entry.size }
    const inside = await this.run(this.workspace.list(key))
    return inside.length > 0 ? { version: FsVersion(`dir-${inside.length}`), type: 'directory' } : undefined
  }

  async lstat(path: string, opts?: { cwd?: string }): Promise<FsPathInfo | undefined> {
    return this.stat(await this.resolve(path, opts))
  }

  async readText(fsTarget: FsTarget): Promise<string> {
    const key = String(fsTarget.targetKey)
    const member = memberFile(key)
    if (member !== undefined) return this.member(member)
    const text = key === '' ? undefined : await this.run(this.workspace.readText(key))
    if (text === undefined) throw new FsError(`${fsTarget.displayPath} does not exist`, 'FS_NOT_FOUND')
    return text
  }

  async streamText(fsTarget: FsTarget): Promise<AsyncIterable<string>> {
    const text = await this.readText(fsTarget)
    return (async function* () { yield text })()
  }

  async readBytes(fsTarget: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const key = String(fsTarget.targetKey)
    const member = memberFile(key)
    const bytes = member !== undefined
      ? new TextEncoder().encode(await this.member(member))
      : new Uint8Array((await this.run(this.workspace.read(key)))?.body ?? new ArrayBuffer(0))
    if (member === undefined && bytes.length === 0 && (await this.stat(fsTarget)) === undefined) throw new FsError(`${fsTarget.displayPath} does not exist`, 'FS_NOT_FOUND')
    if (bytes.length > maxBytes) throw new FsError(`${fsTarget.displayPath} is larger than ${maxBytes} bytes`, 'FS_TOO_LARGE')
    return bytes
  }

  async readByteRange(fsTarget: FsTarget, range: { offset: number; length: number }): Promise<Uint8Array> {
    const bytes = await this.readBytes(fsTarget, undefined, Number.MAX_SAFE_INTEGER)
    return bytes.slice(range.offset, range.offset + range.length)
  }

  async listDir(fsTarget: FsTarget): Promise<FsDirEntry[]> {
    const key = String(fsTarget.targetKey)
    const entries = await this.run(this.workspace.list(key))
    const prefix = key === '' ? '' : `${key}/`
    const seen = new Map<string, FsDirEntry>()
    for (const entry of entries) {
      const rest = entry.path.slice(prefix.length)
      const [first, ...more] = rest.split('/')
      if (first === undefined || first === '') continue
      if (more.length === 0) seen.set(first, { name: first, type: 'file', target: target(`${prefix}${first}`), version: FsVersion(entry.etag), size: entry.size })
      else if (!seen.has(first)) seen.set(first, { name: first, type: 'directory', target: target(`${prefix}${first}`) })
    }
    if (key === '') for (const name of MEMBER_FILE_NAMES) seen.set(name, { name, type: 'file', target: target(name) })
    if (seen.size === 0 && key !== '') throw new FsError(`${fsTarget.displayPath} is not a directory`, 'FS_NOT_FOUND')
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  async writeText(fsTarget: FsTarget, content: string, expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    const key = this.writable(fsTarget)
    const before = await this.run(this.workspace.stat(key))
    if (expected?.kind === 'createIfAbsent' && before !== undefined) throw new FsError(`${fsTarget.displayPath} already exists`, 'FS_STALE_VERSION')
    if (expected?.kind === 'replaceIfVersion' && before?.etag !== String(expected.version)) throw new FsError(`${fsTarget.displayPath} changed since you read it`, 'FS_STALE_VERSION')
    const previous = before === undefined ? null : (await this.run(this.workspace.readText(key))) ?? null
    const written = await this.run(this.workspace.write(key, content))
    return { operation: before === undefined ? 'create' : 'update', version: FsVersion(written.etag), before: previous, after: content }
  }

  async editText(fsTarget: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }): Promise<FsEditOutcome> {
    const key = this.writable(fsTarget)
    const current = await this.run(this.workspace.stat(key))
    if (current === undefined) throw new FsError(`${fsTarget.displayPath} does not exist`, 'FS_NOT_FOUND')
    if (expected !== undefined && current.etag !== String(expected.version)) throw new FsError(`${fsTarget.displayPath} changed since you read it`, 'FS_STALE_VERSION')
    const before = (await this.run(this.workspace.readText(key))) ?? ''
    const count = edit.oldString === '' ? 0 : before.split(edit.oldString).length - 1
    if (count === 0) throw new FsError('the text to replace was not found', 'FS_EDIT_NOT_FOUND')
    if (count > 1 && !edit.replaceAll) throw new FsError(`the text to replace occurs ${count} times; add context or replace all`, 'FS_AMBIGUOUS_EDIT')
    const after = edit.replaceAll ? before.split(edit.oldString).join(edit.newString) : before.replace(edit.oldString, () => edit.newString)
    const written = await this.run(this.workspace.write(key, after))
    return { version: FsVersion(written.etag), before, after }
  }

  private writable(fsTarget: FsTarget): string {
    const key = String(fsTarget.targetKey)
    const member = memberFile(key)
    if (member !== undefined) {
      throw new FsError(`${member} belongs to your owner and is read-only to you. Propose a change with propose_member_file_edit.`, 'FS_PERMISSION_DENIED')
    }
    if (key === '') throw new FsError('the Workspace root is a directory', 'FS_NOT_REGULAR_FILE')
    return key
  }
}
