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
import { MEMORY_AND_FILES } from './memory-and-files.ts'
import { MR_ROBOT } from './mr-robot.ts'
import { PROVIDERS } from './providers.ts'
import { ROBOTS } from './robots.ts'
import { ROUTINES } from './routines.ts'

export const DOCS_DIRECTORY = 'docs'

export interface ProductDoc {
  /** Workspace path, for example docs/robots.md. */
  readonly path: string
  /** One line for the prompt's docs index. */
  readonly summary: string
  readonly text: string
}

const doc = (name: string, summary: string, text: string): ProductDoc => ({ path: `${DOCS_DIRECTORY}/${name}.md`, summary, text })

export const PRODUCT_DOCS: readonly ProductDoc[] = [
  doc('mr-robot', 'What Mr. Robot is: Home, Members, Robots, Turns, and the role of Mr. Robot as chief (Chief of Staff).', MR_ROBOT),
  doc('robots', 'Robots: creation and setup interview, Persona files, settings, Mr. Robot versus other Robots, skills.', ROBOTS),
  doc('grants', 'Grant items and the levels allow, ask and deny; tool-call Asks; propose_grants; my_capabilities.', GRANTS),
  doc('routines', 'Routines: schedule types, the Routine tools, limits, time zone, unattended Turns.', ROUTINES),
  doc('asks-and-help', 'Asks and their kinds; need_help, the 30-minute escalation to Mr. Robot, urgent requests.', ASKS_AND_HELP),
  doc('memory-and-files', 'Memory files and whose they are, the first message of the context, the Workspace layout, the file tools.', MEMORY_AND_FILES),
  doc('connections', 'Connectors and Connections: Google, Slack, Discord; sharing, grants, write access.', CONNECTIONS),
  doc('hosts', 'Hosts: the desktop app, pairing, host_read, host_write, host_run, the Host browser, offline Hosts.', HOSTS),
  doc('browser', 'The browser: backends, logins, Live view, Takeover, payments, screenshots.', BROWSER),
  doc('providers', 'Providers: accounts, model chains, account states, usage, Spend limits.', PROVIDERS),
]

const BY_PATH: ReadonlyMap<string, ProductDoc> = new Map(PRODUCT_DOCS.map((entry) => [entry.path, entry]))

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
