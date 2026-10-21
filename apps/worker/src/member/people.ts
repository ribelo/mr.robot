/**
 * People pages (v1.20 ticket 04, dm-wtn9, dm-s0gy, dm-p7l1, dm-pygh): memory/people/<slug>.md at the Member scope, one page per person the
 * Member deals with. Every Robot of the Member writes them directly (the one exception to proposing Member files; the file history names
 * the Robot). INDEX.md is the platform's, made again on every page write; _template.md is the shape of a new page. Pages at the Space scope
 * are out of scope.
 */

export const PEOPLE_DIRECTORY = 'memory/people'
export const PEOPLE_INDEX = 'memory/people/INDEX.md'
export const PEOPLE_TEMPLATE_PATH = 'memory/people/_template.md'

export const PEOPLE_TEMPLATE = `# <Full name>

Role: <what they are to your owner: customer, accountant, landlord>
How we know them: <where they came from, who introduced them>

## Facts
- <YYYY-MM-DD> <a fact, with the date you learned it>

## History
- <YYYY-MM-DD> <what happened between them and your owner>

## How to talk to them
- <language, tone, channel, what they dislike>
`

/** A page a Robot may write: memory/people/<slug>.md, the slug lowercase letters, digits and dashes. */
export function isPeoplePage(path: string): boolean {
  return /^memory\/people\/[a-z0-9][a-z0-9-]{0,80}\.md$/.test(path) && path !== PEOPLE_INDEX
}

/** Any path under memory/people/ the platform serves: the pages, INDEX.md and the template. */
export function isPeoplePath(path: string): boolean {
  return isPeoplePage(path) || path === PEOPLE_INDEX || path === PEOPLE_TEMPLATE_PATH
}

/** INDEX.md: one line per page, name from its first heading, role from its first "Role:" line, the day it was last touched. */
export function peopleIndex(pages: ReadonlyArray<{ readonly path: string; readonly content: string; readonly updatedAt: number }>): string {
  const lines = [...pages].sort((a, b) => a.path.localeCompare(b.path)).map((page) => {
    const name = /^#\s+(.+)$/m.exec(page.content)?.[1]?.trim() ?? page.path.slice(PEOPLE_DIRECTORY.length + 1, -3)
    const role = /^Role:\s*(.+)$/im.exec(page.content)?.[1]?.trim() ?? ''
    return `- [${name}](${page.path.slice(PEOPLE_DIRECTORY.length + 1)})${role === '' ? '' : ` — ${role}`} (last touched ${new Date(page.updatedAt).toISOString().slice(0, 10)})`
  })
  return ['# People', '', '_Kept by the platform: one line per page. Do not edit._', '', ...(lines.length === 0 ? ['- No pages yet.'] : lines), ''].join('\n')
}
