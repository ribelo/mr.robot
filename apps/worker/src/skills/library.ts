/**
 * The Home skill library (robot-7qpi): skills in R2 under skills/<name>/, synchronised from the
 * admin's Git repository (robot-qjvu) and extended by approved Robot proposals (robot-jqfw).
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

export class SkillSyncError extends Data.TaggedError('SkillSyncError')<{ readonly message: string }> {}

export interface SkillRepository {
  /** owner/name on GitHub */
  readonly repo: string
  readonly ref: string
  /** Directory inside the repository that holds the skills, e.g. "skills". */
  readonly path: string
}

export interface ParsedSkill {
  readonly name: string
  readonly description: string
  /** Files relative to the skill directory, SKILL.md included. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly body: Uint8Array }>
}

const MAX_SKILL_BYTES = 2_000_000

/** Read a gzipped tarball into its regular files (ustar and pax long names). */
export async function untar(gzipped: ReadableStream<Uint8Array> | ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const stream = gzipped instanceof ArrayBuffer ? new Response(gzipped).body! : gzipped
  const bytes = new Uint8Array(await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  const files = new Map<string, Uint8Array>()
  const decoder = new TextDecoder()
  const field = (start: number, length: number) => decoder.decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, '')
  let offset = 0
  let longName: string | undefined
  while (offset + 512 <= bytes.length) {
    const name = field(offset, 100)
    if (name === '') break
    const size = parseInt(field(offset + 124, 12).trim() || '0', 8)
    const type = field(offset + 156, 1)
    const prefix = field(offset + 345, 155)
    const body = bytes.subarray(offset + 512, offset + 512 + size)
    if (type === 'x') {
      const record = decoder.decode(body)
      const match = /\d+ path=([^\n]*)\n/.exec(record)
      longName = match?.[1]
    } else if (type === '0' || type === '') {
      files.set(longName ?? (prefix === '' ? name : `${prefix}/${name}`), body.slice())
      longName = undefined
    } else {
      longName = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

/** name and description from a SKILL.md frontmatter, falling back to the directory name. */
export function frontmatter(markdown: string, fallbackName: string): { name: string; description: string } {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown)
  const read = (key: string) => {
    const line = match?.[1]?.split('\n').find((entry) => entry.startsWith(`${key}:`))
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return { name: read('name') ?? fallbackName, description: read('description') ?? '' }
}

/** Every directory under `root` that holds a SKILL.md is one skill. */
export function skillsInTree(files: Map<string, Uint8Array>, root: string): ParsedSkill[] {
  const paths = [...files.keys()]
  // GitHub tarballs wrap everything in one "<owner>-<repo>-<sha>/" directory.
  const strip = (path: string) => path.split('/').slice(1).join('/')
  const base = root.replace(/^\/+|\/+$/g, '')
  const skills: ParsedSkill[] = []
  for (const path of paths) {
    const relative = strip(path)
    if (!relative.endsWith('/SKILL.md') && relative !== 'SKILL.md') continue
    if (base !== '' && !relative.startsWith(`${base}/`)) continue
    const directory = relative.slice(0, -'SKILL.md'.length)
    const markdown = new TextDecoder().decode(files.get(path)!)
    const meta = frontmatter(markdown, directory.split('/').filter(Boolean).at(-1) ?? 'skill')
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(meta.name)) continue
    let total = 0
    const own = paths
      .filter((candidate) => strip(candidate).startsWith(directory))
      .map((candidate) => ({ path: strip(candidate).slice(directory.length), body: files.get(candidate)! }))
      .filter((file) => {
        total += file.body.length
        return total <= MAX_SKILL_BYTES
      })
    skills.push({ name: meta.name, description: meta.description, files: own })
  }
  return skills
}

/** Download the repository at `ref` through the GitHub API. */
export function fetchRepository(repository: SkillRepository, token: string | null): Effect.Effect<Map<string, Uint8Array>, SkillSyncError> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`https://api.github.com/repos/${repository.repo}/tarball/${encodeURIComponent(repository.ref)}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'mr-robot',
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
      })
      if (!response.ok || response.body === null) throw new Error(`GitHub answered ${response.status} for ${repository.repo}@${repository.ref}`)
      return untar(response.body)
    },
    catch: (cause) => new SkillSyncError({ message: cause instanceof Error ? cause.message : 'cannot download the repository' }),
  })
}
