/**
 * What every place that lists or searches files agrees on (v1.16 ticket 02): the glob syntax, the directories nobody lists and the most
 * matches a search returns. The Worker uses it for the Workspace and the Box; the Host app uses it to answer Glob and Grep in Node,
 * so a Host answers the same on every OS and does not need a shell for it.
 */

/** A glob (* within a segment, ** across segments, ?) as a regular expression over a whole path. */
export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index)
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += pattern[index + 2] === '/' ? '(?:.*/)?' : '.*'
        index += pattern[index + 2] === '/' ? 2 : 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^$()|[\]{}\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/** The directory a glob starts in: the segments before the first wildcard. A pattern without a wildcard is its own start. */
export function globBase(pattern: string): string {
  const parts = pattern.split('/')
  const fixed: string[] = []
  for (const part of parts) {
    if (/[*?]/.test(part)) break
    fixed.push(part)
  }
  const base = fixed.join('/')
  if (base === '') return pattern.startsWith('/') ? '/' : '.'
  return base
}

/** Directories no listing of a Box or a Host shows, at any depth: version control, installed packages and caches are noise for a Robot. */
export const SKIPPED_DIRECTORIES = ['.git', 'node_modules', '.cache'] as const

/** Whether a directory name is one no listing shows. */
export const isSkippedDirectory = (name: string): boolean => SKIPPED_DIRECTORIES.some((skippedName) => skippedName === name)

export const skipped = (path: string): boolean => path.split('/').some(isSkippedDirectory)

/** The most files one glob or grep on a Box or a Host walks; past it the answer says it is truncated. */
export const LISTING_MAX_FILES = 20_000

/** The most matches one grep returns (past it the answer says it is truncated), the longest line it shows, and the largest file it searches. */
export const GREP_MAX_MATCHES = 200
export const GREP_MAX_LINE = 300
export const GREP_MAX_FILE_BYTES = 1_000_000
