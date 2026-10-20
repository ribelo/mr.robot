/**
 * The product docs (v1.11 ticket 02): Markdown the platform ships with the Worker and mounts
 * read-only at /workspace/docs/ in every Robot's Workspace. They are never stored in R2, so a deploy
 * updates them and no Start over or Reset everything can remove them. Each doc is a TS string
 * because the Worker build has no text-import rule for .md files.
 */
import { ASKS_AND_HELP } from './asks-and-help.ts'
import { BROWSER } from './browser.ts'
import { CONNECTIONS } from './connections.ts'
import { GRANTS } from './grants.ts'
import { HOSTS } from './hosts.ts'
import { MEMBERS } from './members.ts'
import { MEMORY_AND_FILES } from './memory-and-files.ts'
import { MR_ROBOT } from './mr-robot.ts'
import { PROVIDERS } from './providers.ts'
import { ROBOTS } from './robots.ts'
import { TASKS } from './tasks.ts'
import { SUBAGENTS } from './subagents.ts'
import { BOX } from './box.ts'
import { AUTO_REVIEW } from './auto-review.ts'
import { PLATFORM_SKILLS, platformSkillPath } from '../skills/platform.ts'

export const DOCS_DIRECTORY = 'docs'

export interface ProductDoc {
  /** Workspace path, for example docs/robots.md. */
  readonly path: string
  /** One line for the prompt's docs index. */
  readonly summary: string
  readonly text: string
  /** A platform skill (docs/skills/<name>/SKILL.md): the skill catalog lists it, the docs index does not (v1.15 ticket 12). */
  readonly platformSkill?: string
}

const doc = (name: string, summary: string, text: string): ProductDoc => ({ path: `${DOCS_DIRECTORY}/${name}.md`, summary, text })

export const PRODUCT_DOCS: readonly ProductDoc[] = [
  doc('mr-robot', 'What Mr. Robot is: Home, Members, Robots, Turns, the chief.', MR_ROBOT),
  doc('members', 'Members: what they own and share, the profile, avatars, the Robot list.', MEMBERS),
  doc('robots', 'Robots: creation and setup, Persona files, settings, Mr. Robot versus other Robots.', ROBOTS),
  doc('grants', 'Grant items and the levels allow, ask and deny; propose_grants; my_capabilities.', GRANTS),
  doc('tasks', 'Tasks: doers, timings, state and attempts, the Task tools, limits, reminders.', TASKS),
  doc('asks-and-help', 'Asks and their kinds; ask, request_credential, asking your chief.', ASKS_AND_HELP),
  doc('memory-and-files', 'Memory files and whose they are, the Workspace layout, the file tools.', MEMORY_AND_FILES),
  doc('connections', 'Connectors and Connections: Google, Slack, Discord; connecting, sharing, grants, instructions.', CONNECTIONS),
  doc('hosts', 'Hosts: the desktop app, pairing, the tools with on set to a Host, modes and write roots, jobs, offline Hosts, the Host browser.', HOSTS),
  doc('browser', 'The browser: backends, logins, Live view, Takeover, payments, screenshots.', BROWSER),
  doc('providers', 'Providers: accounts, model chains, usage, Spend limits.', PROVIDERS),
  doc('subagents', 'Subagents: the grant, subagent and subagent_fork, limits, reports, cost.', SUBAGENTS),
  doc('box', 'The Box: tools and the image, big files, the kept box/ folder, jobs, starting and stopping, cost.', BOX),
  doc('auto-review', 'Auto review: the reviewer, risk levels, a denied call becomes an Ask.', AUTO_REVIEW),
]

/** The platform skills are product docs too: read-only, in the bundle, never in R2 (v1.15 ticket 12, gb-n6by). */
const SKILL_DOCS: readonly ProductDoc[] = PLATFORM_SKILLS.map((entry) => ({ path: platformSkillPath(entry.name), summary: entry.description, text: entry.text, platformSkill: entry.name }))

/** Every file under docs/: the docs and the platform skills. */
export const ALL_DOCS: readonly ProductDoc[] = [...PRODUCT_DOCS, ...SKILL_DOCS]

const BY_PATH: ReadonlyMap<string, ProductDoc> = new Map(ALL_DOCS.map((entry) => [entry.path, entry]))

/** What a docs directory holds: its files and its subdirectories, by name. Undefined when the path is no directory of docs. */
export function docsChildren(directory: string): Array<{ name: string; doc?: ProductDoc }> | undefined {
  const prefix = `${directory}/`
  const found = new Map<string, { name: string; doc?: ProductDoc }>()
  for (const entry of ALL_DOCS) {
    if (!entry.path.startsWith(prefix)) continue
    const [first, ...more] = entry.path.slice(prefix.length).split('/')
    if (first === undefined) continue
    found.set(first, more.length === 0 ? { name: first, doc: entry } : { name: first })
  }
  return found.size === 0 ? undefined : [...found.values()]
}

/** Whether a normalized Workspace path is the docs folder or inside it: the platform owns all of it. */
export function isDocsPath(path: string): boolean {
  return path === DOCS_DIRECTORY || path.startsWith(`${DOCS_DIRECTORY}/`)
}

/** The doc at a normalized Workspace path, if there is one. */
export function productDoc(path: string): ProductDoc | undefined {
  return BY_PATH.get(path)
}

/** The refusal for a write, edit or delete under docs/. */
export function docsReadOnlyMessage(path: string): string {
  return `${path} is in docs/, which the platform owns. The product docs are read-only to you and to your owner; a new release of the platform updates them. Read them; do not write, edit or delete there.`
}
