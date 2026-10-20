/**
 * The pure part of the file tools (v1.16 ticket 01): the same read window, edit and glob on every place.
 * Nothing here knows a place; the backends in files.ts bring the bytes.
 */
import { GREP_MAX_MATCHES } from '@mr-robot/host-protocol'


/** The most lines one read returns, the longest line it shows and the most bytes of lines (as the DSH read tool did). */
export const READ_LIMIT = 2000
const READ_MAX_LINE = 2000
const READ_MAX_BYTES = 50 * 1024

/** A numbered window of a text file, with a footer that says how to continue. */
export function readWindow(displayPath: string, text: string, offset?: number, limit?: number): string {
  const first = offset ?? 1
  const count = Math.min(limit ?? READ_LIMIT, READ_LIMIT)
  if (!Number.isInteger(first) || first < 1) throw new Error('read: offset is a line number from 1')
  if (!Number.isInteger(count) || count < 1) throw new Error('read: limit is a number of lines from 1')
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
  if (lines.at(-1) === '') lines.pop()
  if (first > lines.length && !(lines.length === 0 && first === 1)) throw new Error(`offset ${first} is out of range for "${displayPath}" (${lines.length} lines)`)
  const shown: string[] = []
  let bytes = 0
  let capped = false
  for (let index = first - 1; index < lines.length && shown.length < count; index += 1) {
    const raw = lines[index]!
    const line = raw.length > READ_MAX_LINE ? `${raw.slice(0, READ_MAX_LINE)}... (line truncated to ${READ_MAX_LINE} chars)` : raw
    bytes += new TextEncoder().encode(line).length + 1
    if (bytes > READ_MAX_BYTES) {
      capped = true
      break
    }
    shown.push(`${index + 1}: ${line}`)
  }
  const last = first - 1 + shown.length
  const footer = capped
    ? `(Output capped. Showing lines ${first}-${last}. Use offset=${last + 1} to continue.)`
    : last < lines.length
      ? `(Showing lines ${first}-${last} of ${lines.length}. Use offset=${last + 1} to continue.)`
      : `(End of file - total ${lines.length} lines)`
  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${shown.length > 0 ? `${shown.join('\n')}\n\n${footer}` : footer}\n</content>`
}

/** The text with old_string replaced; a missing or ambiguous match is an error that says how to fix the call. */
export function replaceText(before: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (oldString === '') throw new Error('edit: old_string must not be empty')
  if (oldString === newString) throw new Error('edit: old_string and new_string are the same, so nothing would change')
  const count = before.split(oldString).length - 1
  if (count === 0) throw new Error('the text to replace was not found')
  if (count > 1 && !replaceAll) throw new Error(`the text to replace occurs ${count} times; add context or replace all`)
  return replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString)
}

export { globBase, globToRegExp, skipped, SKIPPED_DIRECTORIES } from '@mr-robot/host-protocol'

/** One argument for a POSIX shell, in single quotes (the Box's commands). */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`
}

export interface GrepMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

export const MAX_GREP_MATCHES = GREP_MAX_MATCHES

/** The matches of a regular expression in a text. */
export function grepText(path: string, text: string, regex: RegExp, room: number): GrepMatch[] {
  const matches: GrepMatch[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (matches.length >= room) break
    if (regex.test(line)) matches.push({ path, line: index + 1, text: line.slice(0, 300) })
  }
  return matches
}
