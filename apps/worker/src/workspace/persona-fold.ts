/**
 * The upgrade to two persona files (v1.18 ticket 01, rm-x8nc, rm-8le0): what a Robot wrote in IDENTITY.md goes into its identity fields
 * and SOUL.md, what it wrote in TOOLS.md into AGENTS.md's tool notes, and MEMORY.md gets its three sections. Pure: the Robot applies it
 * once, with the old files' versions kept by the file history.
 */
import { RETIRED_PERSONA_TEMPLATES } from './templates.ts'

export interface IdentityFields {
  readonly name?: string
  readonly title?: string
  readonly description?: string
}

const FIELD = /^\s*[-*]?\s*\*\*(Name|Title|Role|Description):\*\*\s*(.*)$/i

/** What a file says beyond its template: its lines that are not the template's, without its title line. */
function ownLines(text: string, template: string, title: RegExp): string[] {
  const templateLines = new Set(template.split('\n').map((line) => line.trim()).filter((line) => line !== ''))
  return text.split('\n').filter((line) => !title.test(line.trim()) && !templateLines.has(line.trim()))
}

const trimmed = (lines: readonly string[]) => lines.join('\n').replace(/^\s+|\s+$/g, '')
/** A field still holding the template's placeholder, "_(what you will be called)_", says nothing. */
const said = (value: string) => value.trim() !== '' && !/^_\(.*\)_$/.test(value.trim())

/** IDENTITY.md: its name, title and description lines, and the rest of what the Robot wrote. */
export function foldIdentity(text: string): { readonly fields: IdentityFields; readonly rest: string } {
  const fields: { name?: string; title?: string; description?: string } = {}
  const rest: string[] = []
  for (const line of ownLines(text, RETIRED_PERSONA_TEMPLATES['IDENTITY.md'], /^#\s*IDENTITY\.md/i)) {
    const match = FIELD.exec(line)
    if (match === null) {
      rest.push(line)
      continue
    }
    const key = match[1]!.toLowerCase()
    const value = match[2]!.trim()
    if (!said(value)) continue
    if (key === 'name') fields.name = value
    else if (key === 'description') fields.description = value
    else fields.title = value
  }
  return { fields, rest: trimmed(rest) }
}

/** TOOLS.md: what the Robot wrote there, for AGENTS.md's tool notes. */
export function foldTools(text: string): string {
  return trimmed(ownLines(text, RETIRED_PERSONA_TEMPLATES['TOOLS.md'], /^#\s*TOOLS\.md/i))
}

/** A section added at the end of a Markdown file. */
export function withSection(text: string, heading: string, body: string): string {
  return `${text.replace(/\s+$/, '')}\n\n## ${heading}\n${body}\n`
}

const SECTIONS = ['Facts', 'Preferences', 'Commitments'] as const

/** MEMORY.md in its three sections (rm-8le0): text without them goes under Facts; a missing section is added empty. Undefined when nothing changes. */
export function shapeMemory(text: string): string | undefined {
  const has = (section: string) => new RegExp(`^##\\s+${section}\\s*$`, 'mi').test(text)
  if (SECTIONS.every(has)) return undefined
  if (!SECTIONS.some(has)) {
    const body = text.replace(/^#\s*MEMORY\.md\s*\n?/i, '').replace(/^\s+|\s+$/g, '')
    return `# MEMORY.md\n\n## Facts\n${body === '' ? '' : `${body}\n`}\n## Preferences\n\n## Commitments\n`
  }
  return SECTIONS.filter((section) => !has(section)).reduce((current, section) => `${current.replace(/\s+$/, '')}\n\n## ${section}\n`, text)
}
