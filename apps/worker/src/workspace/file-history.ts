/**
 * File history (v1.18 ticket 02, rm-d68k): every write to a persona file, a memory file or a Member file keeps the version it replaces,
 * with who wrote it and when, so that an edit is a revision and a lost edit comes back. History is bounded (the last 50 versions of a
 * file, 90 days) and kept in R2 under history/, beside the Workspaces and outside them: the Robot's file tools never see or change it.
 */
import * as Schema from 'effect/Schema'

/** Who wrote a version. */
export const FileAuthor = Schema.Union([
  /** A Robot; named when the file is not its own (a people page of its owner, v1.20). */
  Schema.Struct({ kind: Schema.Literal('robot'), name: Schema.optional(Schema.String) }),
  /** A person: the owner in the app, or a Member whose file it is. */
  Schema.Struct({ kind: Schema.Literal('person'), name: Schema.String }),
  /** Mr. Robot, as his owner's deputy or writing a shared file. */
  Schema.Struct({ kind: Schema.Literal('chief'), name: Schema.String }),
  /** The memory sweep before an idle compaction (v1.18 ticket 03). */
  Schema.Struct({ kind: Schema.Literal('sweep') }),
  /** The snapshot before a compaction (v1.20 ticket 01). */
  Schema.Struct({ kind: Schema.Literal('snapshot') }),
  /** The night's dream (v1.20 ticket 05). */
  Schema.Struct({ kind: Schema.Literal('dream') }),
  /** A person brought an earlier version back. */
  Schema.Struct({ kind: Schema.Literal('restore'), name: Schema.String, version: Schema.String }),
  /** Templates and migrations. */
  Schema.Struct({ kind: Schema.Literal('platform') }),
  /** Written before file history existed. */
  Schema.Struct({ kind: Schema.Literal('unknown') }),
])
export type FileAuthor = typeof FileAuthor.Type

/** How a change note and the history name the author. */
export function authorLabel(author: FileAuthor): string {
  switch (author.kind) {
    case 'robot': return author.name ?? 'the Robot'
    case 'person': return author.name
    case 'chief': return author.name
    case 'sweep': return 'the memory sweep'
    case 'snapshot': return 'the snapshot'
    case 'dream': return 'the dream'
    case 'restore': return `${author.name} (restored an earlier version)`
    case 'platform': return 'the platform'
    case 'unknown': return 'unknown (before file history)'
  }
}

/** The last versions kept of a file, and for how long (rm-xusr). */
export const VERSIONS_KEPT = 50
export const VERSION_DAYS_KEPT = 90
const DAY_MS = 86_400_000

/** The Robot's files with history: its persona and memory (rm-d68k) and its dreams (v1.20); IDENTITY.md and TOOLS.md stay, for the versions their fold kept. */
export function isTrackedFile(path: string): boolean {
  return ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'TOOLS.md'].includes(path) || /^(memory|dreams)\/[^/]+\.md$/.test(path)
}

/** One kept version of a file. */
export interface FileVersion {
  readonly id: string
  /** When it was written, and by whom. */
  readonly at: number
  readonly by: FileAuthor
  /** When a later write replaced it (or a delete removed it). */
  readonly replacedAt: number
  readonly size: number
}

/** What R2 keeps on an object about who wrote it. */
export function authorMetadata(by: FileAuthor, at: number): Record<string, string> {
  return { by: JSON.stringify(by), at: String(at) }
}

/** The author an object's metadata names; unknown before file history. */
export function authorOf(metadata: Record<string, string> | undefined, uploaded: number): { by: FileAuthor; at: number } {
  const decoded = metadata?.['by'] === undefined ? undefined : Schema.decodeUnknownOption(Schema.fromJsonString(FileAuthor))(metadata['by'])
  return { by: decoded?._tag === 'Some' ? decoded.value : { kind: 'unknown' }, at: Number(metadata?.['at'] ?? uploaded) || uploaded }
}

/** The history of the files under one base: a Robot's Workspace, a Member's files, the Space's. */
export class FileHistory {
  constructor(private readonly bucket: R2Bucket, private readonly base: string) {}

  private dir(name: string): string {
    return `${this.base}${encodeURIComponent(name)}/`
  }

  /** Keep a version that is being replaced; then trim the file's history (rm-xusr). */
  async keep(name: string, version: { readonly body: string | ArrayBuffer; readonly by: FileAuthor; readonly at: number }, now: number): Promise<void> {
    // Newest first in R2's key order: the key counts down from the far future.
    const id = `${String(9_999_999_999_999 - now).padStart(13, '0')}-${crypto.randomUUID().slice(0, 6)}`
    await this.bucket.put(this.dir(name) + id, version.body, { customMetadata: { ...authorMetadata(version.by, version.at), replaced: String(now) } })
    await this.trim(name, now)
  }

  /** The kept versions of a file, newest first. */
  async list(name: string): Promise<FileVersion[]> {
    const versions: FileVersion[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: this.dir(name), include: ['customMetadata'], ...(cursor === undefined ? {} : { cursor }) })
      for (const object of page.objects) {
        const { by, at } = authorOf(object.customMetadata, object.uploaded.getTime())
        versions.push({ id: object.key.slice(this.dir(name).length), at, by, replacedAt: Number(object.customMetadata?.['replaced'] ?? object.uploaded.getTime()), size: object.size })
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return versions
  }

  /** One kept version's text; undefined when there is none. */
  async read(name: string, id: string): Promise<{ readonly version: FileVersion; readonly text: string } | undefined> {
    if (!/^\d{13}-[0-9a-f]{6}$/.test(id)) return undefined
    const object = await this.bucket.get(this.dir(name) + id)
    if (object === null) return undefined
    const { by, at } = authorOf(object.customMetadata, object.uploaded.getTime())
    return { version: { id, at, by, replacedAt: Number(object.customMetadata?.['replaced'] ?? object.uploaded.getTime()), size: object.size }, text: await object.text() }
  }

  /** Drop the versions past the last 50 and older than 90 days (it runs after each kept version). */
  async trim(name: string, now: number): Promise<void> {
    const versions = await this.list(name)
    const gone = versions.filter((version, index) => index >= VERSIONS_KEPT || version.replacedAt < now - VERSION_DAYS_KEPT * DAY_MS)
    if (gone.length > 0) await this.bucket.delete(gone.map((version) => this.dir(name) + version.id))
  }

  /** The 90-day bound for every file under the base, not only one just written (v1.20.1, v1.18-review #13): run by the daily tidy. */
  async trimAll(now: number): Promise<number> {
    const before = now - VERSION_DAYS_KEPT * DAY_MS
    const gone: string[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: this.base, include: ['customMetadata'], ...(cursor === undefined ? {} : { cursor }) })
      for (const object of page.objects) if (Number(object.customMetadata?.['replaced'] ?? object.uploaded.getTime()) < before) gone.push(object.key)
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    for (let at = 0; at < gone.length; at += 1000) await this.bucket.delete(gone.slice(at, at + 1000))
    return gone.length
  }

  /** Forget every version under the base (the Robot or the Member is deleted). */
  async clear(): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: this.base, ...(cursor === undefined ? {} : { cursor }) })
      if (page.objects.length > 0) await this.bucket.delete(page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
  }
}

/** A version as the app shows it: its author in words. */
export function versionView(version: FileVersion): { id: string; at: number; by: string; replacedAt: number; size: number } {
  return { id: version.id, at: version.at, by: authorLabel(version.by), replacedAt: version.replacedAt, size: version.size }
}

export const robotHistoryBase = (robotId: string) => `history/robots/${robotId}/`
export const memberHistoryBase = (memberId: string) => `history/members/${memberId}/`
export const SPACE_HISTORY_BASE = 'history/space/'
