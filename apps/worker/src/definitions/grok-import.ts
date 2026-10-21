/**
 * Import a Grok Bot marketplace template as a brief (v1.18 ticket 07, rm-pdgk, rm-ewhv, rm-zutf). The template is not offered for
 * download: each marketplace page embeds one 18-key object in its Next.js flight data (docs/research/grok-bot-templates-in-the-wild.md).
 * The importer reads that object, refuses a page without it (it never guesses a field), and maps it to a definition in a brief state,
 * labelled as an imported summary: Grok Bot keeps the recipe closed.
 */
import * as Data from 'effect/Data'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { writeGrants, writeTasks, type GrantsForm, type TasksForm } from './definition.ts'

export class GrokImportError extends Data.TaggedError('GrokImportError')<{ readonly message: string }> {}

const Named = <F extends Schema.Struct.Fields>(fields: F) => Schema.Struct({ id: Schema.String, name: Schema.String, ...fields })

/** The object every marketplace page embeds: exactly these 18 keys, each required. */
export const GrokTemplate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  creatorName: Schema.String,
  handle: Schema.String,
  description: Schema.String,
  summary: Schema.String,
  categories: Schema.Array(Schema.String),
  installCount: Schema.Number,
  color: Schema.String,
  shape: Schema.String,
  addHref: Schema.String,
  imageUrl: Schema.String,
  updatedAt: Schema.String,
  instructions: Schema.String,
  memories: Schema.Array(Named({ description: Schema.String })),
  skills: Schema.Array(Named({ description: Schema.String, content: Schema.String })),
  routines: Schema.Array(Named({ summary: Schema.String })),
  integrations: Schema.Array(Named({ description: Schema.String })),
})
export type GrokTemplate = typeof GrokTemplate.Type
const KEYS = Object.keys(GrokTemplate.fields)

/** The label every imported definition carries (rm-ewhv). */
export const IMPORT_LABEL = 'Imported summary; Grok Bot keeps the recipe closed.'

/** A marketplace page address: https://x.ai/bot/marketplace/bots/<slug>. */
export function parseMarketplaceUrl(text: string): Result.Result<{ readonly url: string; readonly slug: string }, GrokImportError> {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return Result.fail(new GrokImportError({ message: 'that is not an address' }))
  }
  const match = /^\/bot\/marketplace\/bots\/([a-z0-9][a-z0-9-]{0,60})\/?$/.exec(url.pathname)
  if (url.protocol !== 'https:' || (url.hostname !== 'x.ai' && url.hostname !== 'www.x.ai') || match === null) {
    return Result.fail(new GrokImportError({ message: 'give the address of a Grok Bot marketplace page: https://x.ai/bot/marketplace/bots/<name>' }))
  }
  return Result.succeed({ url: `https://x.ai/bot/marketplace/bots/${match[1]}`, slug: match[1]! })
}

/** The flight data of a page: the string of every self.__next_f.push([1, "…"]), unescaped and joined. */
function flightText(html: string): string {
  const pushes = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
  return pushes.map((push) => {
    try {
      return JSON.parse(push[1]!) as string
    } catch {
      return ''
    }
  }).join('')
}

/** The JSON object that starts at `start`, brace-matched outside strings; undefined when it does not close. */
function objectAt(text: string, start: number): string | undefined {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  return undefined
}

/** The template object of a marketplace page (rm-pdgk); refused when the page has none with all 18 keys (rm-zutf). */
export function templateOf(html: string, slug: string): Result.Result<GrokTemplate, GrokImportError> {
  const flight = flightText(html)
  if (flight === '') return Result.fail(new GrokImportError({ message: 'the page carries no Next.js flight data; it is not a marketplace page this importer can read' }))
  const marker = `{"id":"${slug}"`
  let missing: string[] | undefined
  for (let at = flight.indexOf(marker); at >= 0; at = flight.indexOf(marker, at + 1)) {
    const text = objectAt(flight, at)
    if (text === undefined) continue
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    const keys = Object.keys(value as object)
    const absent = KEYS.filter((key) => !keys.includes(key))
    if (absent.length > 0) {
      missing ??= absent
      continue
    }
    const decoded = Schema.decodeUnknownResult(GrokTemplate)(value)
    if (Result.isFailure(decoded)) return Result.fail(new GrokImportError({ message: `the template object is not in the known shape: ${decoded.failure.message}` }))
    return Result.succeed(decoded.success)
  }
  return Result.fail(new GrokImportError({ message: missing === undefined ? `the page has no template object for "${slug}"` : `the template object lacks ${missing.join(', ')}; nothing is guessed` }))
}

/** Grok Bot integrations by name and the connector each maps to; one with none becomes a note (rm-ewhv). */
const CONNECTORS: ReadonlyArray<readonly [RegExp, 'google' | 'slack' | 'discord']> = [
  [/^(gmail|google( (calendar|drive|docs|sheets|contacts|workspace))?)$/i, 'google'],
  [/^slack$/i, 'slack'],
  [/^discord$/i, 'discord'],
]

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill'
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The definition files of an imported template: a brief, never a working Robot. */
export function briefOf(template: GrokTemplate, source: string): Map<string, Uint8Array> {
  const encode = (text: string) => new TextEncoder().encode(text)
  const files = new Map<string, Uint8Array>()
  const about = template.summary.trim() === '' ? template.description : template.summary
  files.set('README.md', encode([
    `# ${template.name}`,
    '',
    oneLine(about),
    '',
    `> ${IMPORT_LABEL} Source: ${source}, by ${template.creatorName} (@${template.handle}).`,
    '',
    'The interview will ask:',
    '- what this Robot is to watch or do for you, in your own words',
    ...template.routines.map((routine) => `- when "${routine.name}" should run`),
    '',
  ].join('\n')))
  files.set('SOUL.md', encode(`# SOUL.md\n\n_A first draft from the imported summary; rewrite it as you learn the job._\n\n${template.description.trim()}\n`))
  files.set('MEMORY.md', encode(['# MEMORY.md', '', '## Facts', ...template.memories.map((memory) => `- ${oneLine(memory.description)}`), '', '## Preferences', '', '## Commitments', ''].join('\n')))
  const used = new Set<string>()
  for (const skill of template.skills) {
    let name = slugOf(skill.name)
    while (used.has(name)) name = `${name}-2`
    used.add(name)
    const description = oneLine(skill.description).replaceAll('\n', ' ')
    files.set(`skills/${name}/SKILL.md`, encode(`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${skill.name}\n\n${oneLine(skill.content)}\n\n_A one-line stub from the imported summary: the playbook itself was not published._\n`))
  }
  const tasks: TasksForm = { version: 1, tasks: template.routines.map((routine) => ({ title: routine.name, instructions: oneLine(routine.summary), timing: { kind: 'unscheduled' as const }, enabled: false as const })) }
  files.set('tasks.yaml', encode(writeTasks(tasks)))
  const connectors: GrantsForm['connectors'][number][] = []
  const notes: string[] = []
  for (const integration of template.integrations) {
    const kind = CONNECTORS.find(([pattern]) => pattern.test(integration.name.trim()))?.[1]
    if (kind === undefined) notes.push(`${integration.name}: no Connector in Mr. Robot (${oneLine(integration.description)})`)
    else if (!connectors.some((entry) => entry.kind === kind)) connectors.push({ kind, write: false, level: 'ask' })
  }
  const grants: GrantsForm = { version: 1, tools: { files: 'allow', web: 'allow', tasks: 'allow' }, connectors, logins: [], hosts: [], ...(notes.length === 0 ? {} : { notes }) }
  files.set('grants.yaml', encode(writeGrants(grants)))
  return files
}

/** The most of a page the importer reads, and how long it waits (v1.20.1, v1.18-review #17). */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024
export const FETCH_TIMEOUT_MS = 15_000

/**
 * Fetch a marketplace page as a browser would (the site serves the flight data to a browser User-Agent), bounded: x.ai only, no redirect
 * elsewhere, at most MAX_PAGE_BYTES, at most FETCH_TIMEOUT_MS. The edge Worker calls it; the Space gets the text.
 */
export async function fetchGrokPage(address: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Result.Result<{ readonly url: string; readonly slug: string; readonly html: string }, GrokImportError>> {
  const parsed = parseMarketplaceUrl(address)
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure)
  try {
    const response = await fetch(parsed.success.url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', accept: 'text/html' } })
    if (response.status >= 300 && response.status < 400) return Result.fail(new GrokImportError({ message: 'the marketplace answered with a redirect; only the page itself is read' }))
    if (!response.ok) return Result.fail(new GrokImportError({ message: `the marketplace answered ${response.status}` }))
    if (Number(response.headers.get('content-length') ?? 0) > MAX_PAGE_BYTES) return Result.fail(new GrokImportError({ message: 'the page is larger than 5 MB' }))
    const reader = response.body?.getReader()
    if (reader === undefined) return Result.fail(new GrokImportError({ message: 'the page was empty' }))
    const parts: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel()
        return Result.fail(new GrokImportError({ message: 'the page is larger than 5 MB' }))
      }
      parts.push(value)
    }
    const body = new Uint8Array(size)
    let at = 0
    for (const part of parts) {
      body.set(part, at)
      at += part.byteLength
    }
    return Result.succeed({ url: parsed.success.url, slug: parsed.success.slug, html: new TextDecoder().decode(body) })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    return Result.fail(new GrokImportError({ message: timedOut ? 'the marketplace did not answer within 15 seconds' : `the page could not be fetched: ${error instanceof Error ? error.message : String(error)}` }))
  }
}
