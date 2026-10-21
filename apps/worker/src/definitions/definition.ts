/**
 * Robot definitions (v1.18 ticket 04, rm-hjpa, rm-tszp, rm-77oh): a Robot as files, robots/<slug>/ in the library repository or
 * definitions/<slug>/ in the Space's library: SOUL.md, AGENTS.md, MEMORY.md, skills/, README.md, and tasks.yaml and grants.yaml, which
 * the platform writes and reads and people only read. The YAML is 1.2 core schema (so "no" stays a string) and parses into schemas that
 * refuse unknown keys. A definition names connectors by kind and logins by purpose, never a Connection or an entry (rm-77oh).
 */
import * as Data from 'effect/Data'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { parse, stringify } from 'yaml'
import { ConnectorKind, GrantLevel, RecurringSchedule, type ConnectionView, type GrantSet, type TaskView } from '@mr-robot/protocol'

/** A definition's directory name: lowercase letters, digits and dashes. */
export const DefinitionSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))
export type DefinitionSlug = typeof DefinitionSlug.Type

/** The files a definition carries besides the two YAML forms. */
export const DEFINITION_FILES = ['README.md', 'SOUL.md', 'AGENTS.md', 'MEMORY.md'] as const

const DefinitionTiming = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('recurring'), schedule: RecurringSchedule, timeZone: Schema.String }),
  /** A moment, as ISO 8601 text, so a diff reads it. */
  Schema.Struct({ kind: Schema.Literal('scheduled'), at: Schema.String }),
  /** No moment: a brief's routine (the Grok importer) that the owner times himself. */
  Schema.Struct({ kind: Schema.Literal('unscheduled') }),
])

export const DefinitionTask = Schema.Struct({
  title: Schema.String,
  instructions: Schema.String,
  timing: DefinitionTiming,
  /** Always false in a definition: Tasks arrive paused and the Robot asks once (rm-xgau). */
  enabled: Schema.Literal(false),
})
export type DefinitionTask = typeof DefinitionTask.Type

export const TasksForm = Schema.Struct({ version: Schema.Literal(1), tasks: Schema.Array(DefinitionTask) })
export type TasksForm = typeof TasksForm.Type

export const GrantsForm = Schema.Struct({
  version: Schema.Literal(1),
  /** Tool groups and their levels. */
  tools: Schema.Record(Schema.String, GrantLevel),
  /** Connectors by kind; write also sends (Gmail send, Slack post). */
  connectors: Schema.Array(Schema.Struct({ kind: ConnectorKind, write: Schema.Boolean, level: GrantLevel })),
  /** Logins by what they are for (a site), never an entry name. */
  logins: Schema.Array(Schema.Struct({ purpose: Schema.String, level: GrantLevel })),
  /** Host facets, never a Host. */
  hosts: Schema.Array(Schema.Struct({ facet: Schema.Literals(['files', 'shell', 'browser']), level: GrantLevel })),
  /** A note per need the platform cannot meet yet (an importer's integration without a Connector). */
  notes: Schema.optional(Schema.Array(Schema.String)),
})
export type GrantsForm = typeof GrantsForm.Type

/** A form that does not parse: its file and why. */
export class DefinitionFormError extends Data.TaggedError('DefinitionFormError')<{ readonly file: string; readonly message: string }> {}

const STRICT = { onExcessProperty: 'error' } as const

function parseForm<S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, file: string, text: string): Result.Result<S['Type'], DefinitionFormError> {
  let value: unknown
  try {
    value = parse(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true })
  } catch (error) {
    return Result.fail(new DefinitionFormError({ file, message: error instanceof Error ? error.message : String(error) }))
  }
  const decoded = Schema.decodeUnknownResult(schema as never, STRICT)(value) as Result.Result<S['Type'], Schema.SchemaError>
  return Result.mapError(decoded, (error) => new DefinitionFormError({ file, message: error.message }))
}

export const parseTasks = (text: string) => parseForm(TasksForm, 'tasks.yaml', text)
export const parseGrants = (text: string) => parseForm(GrantsForm, 'grants.yaml', text)

const HEADER = '# Written by Mr. Robot. Read it and diff it; do not edit it by hand.\n'
const yamlOf = (value: unknown) => HEADER + stringify(value, { version: '1.2', schema: 'core', lineWidth: 0 })

export const writeTasks = (form: TasksForm): string => yamlOf(form)
export const writeGrants = (form: GrantsForm): string => yamlOf(form)

/** The recurring and scheduled Tasks of a Robot, paused (rm-xgau); unscheduled ones are a moment's work, not part of a design. */
export function tasksFormOf(tasks: readonly TaskView[]): TasksForm {
  return {
    version: 1,
    tasks: tasks.flatMap((task): DefinitionTask[] => {
      if (task.state !== 'open') return []
      if (task.timing.kind === 'recurring') return [{ title: task.title, instructions: task.instructions, timing: { kind: 'recurring', schedule: task.timing.schedule, timeZone: task.timing.timeZone }, enabled: false }]
      if (task.timing.kind === 'scheduled') return [{ title: task.title, instructions: task.instructions, timing: { kind: 'scheduled', at: new Date(task.timing.at).toISOString() }, enabled: false }]
      return []
    }),
  }
}

const RANK: Record<GrantLevel, number> = { deny: 0, ask: 1, allow: 2 }
const stronger = (a: GrantLevel | undefined, b: GrantLevel) => (a === undefined || RANK[b] > RANK[a] ? b : a)

/**
 * What a Robot needs, from its Grants (rm-77oh): tool groups as they are, each Connection by its kind, each login by the sites it is for,
 * each Host grant by its facet. Denied items are left out: a definition says what is needed.
 */
export function grantsFormOf(grants: GrantSet, connections: readonly ConnectionView[], loginSites: (name: string) => readonly string[]): GrantsForm {
  const tools = Object.fromEntries(Object.entries(grants.tools).filter(([, level]) => level !== 'deny'))
  const connectors = new Map<string, { kind: typeof ConnectorKind.Type; write: boolean; level: GrantLevel }>()
  for (const [key, level] of Object.entries(grants.connections)) {
    if (level === 'deny') continue
    const [id, write] = key.split(':')
    const kind = connections.find((connection) => connection.id === id)?.kind
    if (kind === undefined) continue
    const mapKey = `${kind}:${write === 'write'}`
    connectors.set(mapKey, { kind, write: write === 'write', level: stronger(connectors.get(mapKey)?.level, level) })
  }
  const logins = new Map<string, GrantLevel>()
  for (const [name, level] of Object.entries(grants.secrets)) {
    if (level === 'deny') continue
    const sites = loginSites(name)
    for (const purpose of sites.length === 0 ? ['a login without a website'] : sites) logins.set(purpose, stronger(logins.get(purpose), level))
  }
  const hosts = new Map<'files' | 'shell' | 'browser', GrantLevel>()
  for (const [key, level] of Object.entries(grants.hosts)) {
    const facet = key.split(':').at(-1)
    if (level === 'deny' || (facet !== 'files' && facet !== 'shell' && facet !== 'browser')) continue
    hosts.set(facet, stronger(hosts.get(facet), level))
  }
  return {
    version: 1,
    tools,
    connectors: [...connectors.values()].sort((a, b) => a.kind.localeCompare(b.kind) || Number(a.write) - Number(b.write)),
    logins: [...logins.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([purpose, level]) => ({ purpose, level })),
    hosts: [...hosts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([facet, level]) => ({ facet, level })),
  }
}

/** A definition's README: its first heading is the title, its first paragraph the description (the Marketplace shows both). */
export function readmeSummary(readme: string, fallback: string): { readonly title: string; readonly paragraph: string } {
  const title = /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() ?? fallback
  const paragraph = readme.replace(/^#.*$/gm, '').split(/\n\s*\n/).map((part) => part.trim()).find((part) => part !== '' && !part.startsWith('<!--')) ?? ''
  return { title, paragraph }
}

/** One definition as files, keyed by their path in its directory. */
export type DefinitionFiles = ReadonlyMap<string, Uint8Array>

/** The definitions in a repository tree: every robots/<slug>/ directory with a README.md or a SOUL.md (rm-vob8). */
export function definitionsInTree(files: ReadonlyMap<string, Uint8Array>, root = 'robots'): Array<{ readonly slug: string; readonly files: DefinitionFiles }> {
  // GitHub tarballs wrap everything in one "<owner>-<repo>-<sha>/" directory.
  const strip = (path: string) => path.split('/').slice(1).join('/')
  const found = new Map<string, Map<string, Uint8Array>>()
  for (const [path, body] of files) {
    const match = new RegExp(`^${root}/([a-z0-9][a-z0-9-]{0,63})/(.+)$`).exec(strip(path))
    if (match === null) continue
    const own = found.get(match[1]!) ?? new Map<string, Uint8Array>()
    own.set(match[2]!, body)
    found.set(match[1]!, own)
  }
  return [...found.entries()].filter(([, own]) => own.has('README.md') || own.has('SOUL.md')).map(([slug, own]) => ({ slug, files: own }))
}

/** What a stored definition is checked for before it enters the library: its two forms parse. */
export function checkForms(files: DefinitionFiles): Result.Result<{ readonly tasks: TasksForm; readonly grants: GrantsForm }, DefinitionFormError> {
  const text = (path: string) => new TextDecoder().decode(files.get(path) ?? new Uint8Array())
  const tasks = files.has('tasks.yaml') ? parseTasks(text('tasks.yaml')) : Result.succeed<TasksForm>({ version: 1, tasks: [] })
  if (Result.isFailure(tasks)) return Result.fail(tasks.failure)
  const grants = files.has('grants.yaml') ? parseGrants(text('grants.yaml')) : Result.succeed<GrantsForm>({ version: 1, tools: {}, connectors: [], logins: [], hosts: [] })
  if (Result.isFailure(grants)) return Result.fail(grants.failure)
  return Result.succeed({ tasks: tasks.success, grants: grants.success })
}
