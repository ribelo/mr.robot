/**
 * Memory (v1.3 ticket 02): the files a Robot works from, in three scopes, rendered as one durable
 * baseline message within a byte budget (pl-w3n0, pl-jsdm), and the change notes that follow a
 * file edit (pl-9n7w). Modelled on DSH agent-instructions: broad to specific, broader files are
 * truncated first, content framed in <system-reminder>.
 */

export type MemoryScope = 'home' | 'member' | 'robot'

export interface MemoryFile {
  readonly scope: MemoryScope
  readonly path: string
  readonly content: string
}

export interface MemoryChange {
  readonly path: string
  /** "your owner", "Mr. Robot", a Robot's name, "the Home admin". */
  readonly by: string
  /** A change that is not a file (the owner's time zone): the note itself, shown as it is. */
  readonly notice?: string
}

/** Broadest first: the Home, the owner, then the Robot's own files, daily notes last. */
const ROBOT_ORDER = ['TOOLS.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'SOUL.md']
const MEMBER_ORDER = ['memory/world.md', 'PROACTIVE_PREFERENCES.md', 'USER.md']

function rank(file: MemoryFile): number {
  if (file.scope === 'home') return 0
  if (file.scope === 'member') return 10 + Math.max(0, MEMBER_ORDER.indexOf(file.path))
  const index = ROBOT_ORDER.indexOf(file.path)
  return index === -1 ? 100 : 20 + index // daily notes and other own files: most specific
}

export function broadToSpecific(files: readonly MemoryFile[]): MemoryFile[] {
  return [...files].filter((file) => file.content.trim() !== '').sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

const SCOPE_NOTE: Record<MemoryScope, string> = {
  home: 'shared by the whole Home',
  member: "your owner's, shared by all their Robots",
  robot: 'yours',
}

const escape = (text: string) => text.replaceAll('</system-reminder>', '<\\/system-reminder>')
const block = (file: MemoryFile, content: string) => `<file path="${file.path}" scope="${file.scope}" (${SCOPE_NOTE[file.scope]})>\n${escape(content.trim())}\n</file>`
const bytes = (text: string) => new TextEncoder().encode(text).length

/**
 * How a Robot changes owner and Home files (v1.11, sk-a2yy): Mr. Robot writes them, other Robots propose
 * edits, a Robot in setup has no tool for them. The memory header names only the tool the Robot has.
 */
export type SharedFileEdit = 'write' | 'propose' | 'none'

const SHARED_EDIT: Record<SharedFileEdit, string> = {
  write: 'The file tools cannot change them; write them with memory_write_shared (the complete new file).',
  propose: 'They are read-only to you; propose an edit with propose_member_file_edit and your owner approves it.',
  none: 'They are read-only to you.',
}

const head = (edit: SharedFileEdit) => [
  '<system-reminder>',
  `Your memory and persona files as of now. Robot files are yours to edit with the file tools. Owner files (USER.md, PROACTIVE_PREFERENCES.md, memory/world.md) and Home files (HOME.md) are shared. ${SHARED_EDIT[edit]} When a file changes later you get a note naming it.`,
].join('\n')
const TAIL = '</system-reminder>'

/**
 * The baseline message text. Over budget, the broadest files are dropped first and the most
 * specific one is truncated last; a notice names what was cut.
 */
export function renderBaseline(files: readonly MemoryFile[], maxBytes: number, edit: SharedFileEdit): string {
  const opening = head(edit)
  const ordered = broadToSpecific(files)
  const kept = ordered.map((file) => ({ file, content: file.content }))
  const cut: string[] = []
  const render = (notice: string) => [opening, ...kept.filter((entry) => entry.content !== '').map((entry) => block(entry.file, entry.content)), ...(notice === '' ? [] : [notice]), TAIL].join('\n\n')
  const noticeFor = () => (cut.length === 0 ? '' : `Memory budget: ${cut.join(', ')} left out or shortened to fit ${maxBytes} bytes; read them with the file tools if you need them.`)
  for (let index = 0; index < kept.length && bytes(render(noticeFor())) > maxBytes; index++) {
    const entry = kept[index]!
    const isLast = index === kept.length - 1
    if (!isLast) {
      // A broader file is dropped whole before the most specific one is touched.
      entry.content = ''
      cut.push(entry.file.path)
      continue
    }
    cut.push(entry.file.path)
    const over = bytes(render(noticeFor())) - maxBytes
    const encoded = new TextEncoder().encode(entry.content)
    entry.content = new TextDecoder().decode(encoded.slice(0, Math.max(0, encoded.length - over - 32))) + '\n[truncated]'
  }
  return render(noticeFor())
}

/** The note that follows edits made since the last Turn (pl-9n7w), with the current content of each changed file. */
export function renderChanges(changes: readonly MemoryChange[], files: readonly MemoryFile[], maxBytes: number): string {
  const notices = changes.flatMap((change) => (change.notice === undefined ? [] : [change.notice]))
  const byPath = new Map<string, string[]>()
  for (const change of changes.filter((entry) => entry.notice === undefined)) byPath.set(change.path, [...new Set([...(byPath.get(change.path) ?? []), change.by])])
  const parts = [...byPath.entries()].map(([path, by]) => {
    const file = files.find((entry) => entry.path === path)
    const head = `changed: ${path} by ${by.join(', ')}`
    if (file === undefined || file.content.trim() === '') return `${head} (now empty or removed)`
    return `${head}\n${block(file, file.content)}`
  })
  const lead = parts.length === 0 ? [] : ['Memory changed since your last Turn. The current version of each changed file follows; rely on it, not on an earlier copy.', ...parts]
  let text = ['<system-reminder>', ...lead, ...notices, '</system-reminder>'].join('\n\n')
  if (bytes(text) > maxBytes) text = ['<system-reminder>', ...(parts.length === 0 ? [] : ['Memory changed since your last Turn; read these files again with the file tools:', ...[...byPath.entries()].map(([path, by]) => `changed: ${path} by ${by.join(', ')}`)]), ...notices, '</system-reminder>'].join('\n')
  return text
}
