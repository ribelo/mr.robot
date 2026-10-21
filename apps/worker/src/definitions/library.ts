/**
 * Robot definitions in the Space's library (v1.18 ticket 04, rm-hjpa, rm-vob8, rm-gxp7): one row per definition and its files in R2
 * under definitions/<slug>/. Source 'git' came from the library repository's robots/<slug>/ by the sync; 'robot' was saved from a Robot
 * (Save as definition). A definition is a snapshot: nothing links it to the Robot it came from. When the repository holds a slug a
 * Robot also saved, the repository's wins and the saved one goes (the admin committed the downloaded directory by hand).
 */
import * as Result from 'effect/Result'
import { checkForms, readmeSummary, type DefinitionFiles, type GrantsForm } from './definition.ts'

export type DefinitionSource = 'git' | 'robot' | 'import'

export const DEFINITION_SCHEMA = `CREATE TABLE IF NOT EXISTS definition (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  paragraph TEXT NOT NULL,
  source TEXT NOT NULL,
  owner_id TEXT,
  author TEXT NOT NULL,
  published INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`

export interface DefinitionRow {
  readonly slug: string
  readonly title: string
  readonly paragraph: string
  readonly source: DefinitionSource
  /** The Member who saved or imported it; null for the repository's. */
  readonly ownerId: string | null
  readonly author: string
  /** In the Marketplace for every Member; otherwise its owner's only (ticket 06 publishes). */
  readonly published: boolean
  readonly updatedAt: number
}

type Row = { slug: string; title: string; paragraph: string; source: DefinitionSource; owner_id: string | null; author: string; published: number; updated_at: number }
const fromSql = (row: Row): DefinitionRow => ({ slug: row.slug, title: row.title, paragraph: row.paragraph, source: row.source, ownerId: row.owner_id, author: row.author, published: row.published === 1, updatedAt: row.updated_at })

export const definitionPrefix = (slug: string) => `definitions/${slug}/`

export class DefinitionLibrary {
  constructor(private readonly sql: SqlStorage, private readonly bucket: R2Bucket) {}

  get(slug: string): DefinitionRow | undefined {
    const row = this.sql.exec<Row>('SELECT * FROM definition WHERE slug = ?', slug).toArray()[0]
    return row === undefined ? undefined : fromSql(row)
  }

  /** The definitions a Member sees: the published ones and his own. */
  visible(memberId: string): DefinitionRow[] {
    return this.sql.exec<Row>('SELECT * FROM definition WHERE published = 1 OR owner_id = ? ORDER BY title', memberId).toArray().map(fromSql)
  }

  all(): DefinitionRow[] {
    return this.sql.exec<Row>('SELECT * FROM definition ORDER BY title').toArray().map(fromSql)
  }

  async files(slug: string): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>()
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: definitionPrefix(slug), ...(cursor === undefined ? {} : { cursor }) })
      for (const object of page.objects) {
        const body = await this.bucket.get(object.key)
        if (body !== null) files.set(object.key.slice(definitionPrefix(slug).length), new Uint8Array(await body.arrayBuffer()))
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return files
  }

  /**
   * Store a definition (its files replace the previous ones). Refused when its forms do not parse, or when the slug is the repository's
   * and this one is not, or another Member's.
   */
  async store(slug: string, files: DefinitionFiles, meta: { readonly source: DefinitionSource; readonly ownerId: string | null; readonly author: string; readonly published: boolean }, now: number): Promise<Result.Result<DefinitionRow, string>> {
    const forms = checkForms(files)
    if (Result.isFailure(forms)) return Result.fail(`${forms.failure.file}: ${forms.failure.message}`)
    const existing = this.get(slug)
    if (existing !== undefined && meta.source !== 'git' && (existing.source === 'git' || existing.ownerId !== meta.ownerId)) {
      return Result.fail(`a definition named "${slug}" already exists in the library; choose another name`)
    }
    await this.removeFiles(slug)
    await Promise.all([...files.entries()].map(([path, body]) => this.bucket.put(definitionPrefix(slug) + path, body)))
    const { title, paragraph } = readmeSummary(new TextDecoder().decode(files.get('README.md') ?? new Uint8Array()), slug)
    this.sql.exec(
      `INSERT INTO definition (slug, title, paragraph, source, owner_id, author, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET title = excluded.title, paragraph = excluded.paragraph, source = excluded.source, owner_id = excluded.owner_id,
         author = excluded.author, published = excluded.published, updated_at = excluded.updated_at`,
      slug, title, paragraph, meta.source, meta.ownerId, meta.author, meta.published ? 1 : 0, now,
    )
    return Result.succeed(this.get(slug)!)
  }

  /** The repository's definitions replace the previous Git ones and any saved one of the same slug (rm-vob8). Returns the slugs synced and the refused. */
  async sync(found: ReadonlyArray<{ readonly slug: string; readonly files: DefinitionFiles }>, now: number): Promise<{ synced: string[]; refused: Array<{ slug: string; reason: string }> }> {
    const synced: string[] = []
    const refused: Array<{ slug: string; reason: string }> = []
    for (const definition of found) {
      const stored = await this.store(definition.slug, definition.files, { source: 'git', ownerId: null, author: 'the library repository', published: true }, now)
      if (Result.isFailure(stored)) refused.push({ slug: definition.slug, reason: stored.failure })
      else synced.push(definition.slug)
    }
    for (const gone of this.sql.exec<{ slug: string }>("SELECT slug FROM definition WHERE source = 'git'").toArray().map((row) => row.slug).filter((slug) => !synced.includes(slug))) {
      await this.remove(gone)
    }
    return { synced, refused }
  }

  /** A definition's grants.yaml as read (a stored definition's forms parsed when it entered the library). */
  grantsOf(files: DefinitionFiles): GrantsForm {
    const forms = checkForms(files)
    return Result.isSuccess(forms) ? forms.success.grants : { version: 1, tools: {}, connectors: [], logins: [], hosts: [] }
  }

  setPublished(slug: string, published: boolean): void {
    this.sql.exec('UPDATE definition SET published = ? WHERE slug = ?', published ? 1 : 0, slug)
  }

  async remove(slug: string): Promise<void> {
    await this.removeFiles(slug)
    this.sql.exec('DELETE FROM definition WHERE slug = ?', slug)
  }

  private async removeFiles(slug: string): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix: definitionPrefix(slug), ...(cursor === undefined ? {} : { cursor }) })
      if (page.objects.length > 0) await this.bucket.delete(page.objects.map((object) => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
  }
}
