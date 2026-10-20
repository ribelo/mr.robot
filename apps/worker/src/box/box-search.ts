/**
 * glob and grep on the Box (deep review P15): ripgrep walks /workspace in the container, not the Worker file by file. This module is the
 * pure part: the answers' shapes, the rg argument lists the container runs (container.ts) and the parse of what rg prints. The stub Box
 * answers the same questions over memory.
 */
import { GREP_MAX_FILE_BYTES, GREP_MAX_LINE, GREP_MAX_MATCHES, LISTING_MAX_FILES, SKIPPED_DIRECTORIES } from '@mr-robot/host-protocol'

/** The files of a listing, relative to /workspace; `truncated` when the walk stopped at LISTING_MAX_FILES files. */
export interface BoxFileList {
  readonly paths: readonly string[]
  readonly truncated: boolean
}

export interface BoxGrepQuery {
  /** A ripgrep regular expression. */
  readonly pattern: string
  readonly ignoreCase: boolean
  /** Only files whose path relative to /workspace matches this glob. */
  readonly glob?: string
  /** A file or directory relative to /workspace to search; all of /workspace when left out. */
  readonly under?: string
}

export interface BoxGrepMatch {
  readonly path: string
  readonly line: number
  readonly text: string
}

/** What a grep on the Box found (at most GREP_MAX_MATCHES; `truncated` when there were more), or the pattern ripgrep refused. */
export type BoxGrepResult =
  | { readonly _tag: 'Matches'; readonly matches: readonly BoxGrepMatch[]; readonly truncated: boolean }
  | { readonly _tag: 'BadPattern'; readonly message: string }

/** What one rg run printed and how it ended. */
export interface RgOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** How long one search may take on the Box; a search cut by it answers what it found, truncated. */
export const BOX_SEARCH_SECONDS = 60
/** The exit code of coreutils timeout when the time ran out. */
const TIMED_OUT = 124
/** rg's exit codes: a match, none, an error (a bad pattern, or a path that is not there). */
const RG_ENDED = [0, 1, 2, TIMED_OUT]

/** Every file, hidden or git-ignored too (as before ripgrep), except the SKIPPED_DIRECTORIES at any depth and the platform's job files. */
const WALK = ['--no-config', '--hidden', '--no-ignore', '--no-messages']
const EXCLUDED = [...SKIPPED_DIRECTORIES.flatMap((name) => ['-g', `!${name}`]), '-g', '!/.jobs']

/** The rg arguments that list the files under `under` (relative to /workspace, the working directory). */
export function filesArgs(under: string | undefined): string[] {
  return ['--files', ...WALK, ...EXCLUDED, '--', ...(under === undefined ? [] : [under])]
}

/** The rg arguments of a grep: one line per match, `path NUL line:text`, long lines cut, files over GREP_MAX_FILE_BYTES skipped. */
export function grepArgs(query: BoxGrepQuery): string[] {
  // A glob is anchored at /workspace, as on the other places; the excludes come after it, so they win.
  const glob = query.glob === undefined ? [] : ['-g', query.glob.startsWith('/') ? query.glob : `/${query.glob}`]
  return [
    '--null', '--no-heading', '--with-filename', '--line-number', '--color', 'never', ...WALK,
    '--max-filesize', String(GREP_MAX_FILE_BYTES), '--max-columns', String(GREP_MAX_LINE), '--max-columns-preview', '--engine', 'auto',
    ...(query.ignoreCase ? ['-i'] : []), ...glob, ...EXCLUDED, '-e', query.pattern, '--', ...(query.under === undefined ? [] : [query.under]),
  ]
}

/**
 * A bash script that runs rg with its arguments ("$@") under the time limit and keeps the first `lines` lines; it exits with rg's code.
 * stdin is /dev/null: rg without a path searches a piped stdin instead of the working directory.
 */
export function cappedRg(lines: number): string {
  return `timeout --kill-after=5 ${BOX_SEARCH_SECONDS} rg "$@" < /dev/null | head -n ${lines}; exit "\${PIPESTATUS[0]}"`
}

/** The lines rg printed; cappedRg keeps one more than the cap, so a line past the cap shows there were more. */
const printed = (stdout: string): string[] => stdout.split('\n').filter((line) => line !== '')

/** A listing from filesArgs run by cappedRg(LISTING_MAX_FILES + 1). A path that is not there lists nothing. @throws Error when rg could not run. */
export function parseFiles(out: RgOutput): BoxFileList {
  if (!RG_ENDED.includes(out.exitCode)) throw new Error(`glob on the Box failed (exit ${out.exitCode}): ${out.stderr.trim()}`)
  const paths = printed(out.stdout)
  return { paths: paths.slice(0, LISTING_MAX_FILES), truncated: paths.length > LISTING_MAX_FILES || out.exitCode === TIMED_OUT }
}

/**
 * Matches from grepArgs run by cappedRg(GREP_MAX_MATCHES + 1). rg exits 2 with words on stderr only for what --no-messages does not
 * silence, the pattern; a path that is not there exits 2 silently and matches nothing. @throws Error when rg could not run.
 */
export function parseGrep(out: RgOutput): BoxGrepResult {
  const lines = printed(out.stdout)
  if (out.exitCode === 2 && lines.length === 0 && out.stderr.trim() !== '') return { _tag: 'BadPattern', message: out.stderr.trim() }
  if (!RG_ENDED.includes(out.exitCode)) throw new Error(`grep on the Box failed (exit ${out.exitCode}): ${out.stderr.trim()}`)
  const matches = lines.slice(0, GREP_MAX_MATCHES).flatMap((line): BoxGrepMatch[] => {
    const nul = line.indexOf('\u0000')
    const colon = line.indexOf(':', nul + 1)
    if (nul < 0 || colon < 0) return []
    return [{ path: line.slice(0, nul), line: Number(line.slice(nul + 1, colon)), text: line.slice(colon + 1, colon + 1 + GREP_MAX_LINE) }]
  })
  return { _tag: 'Matches', matches, truncated: lines.length > GREP_MAX_MATCHES || out.exitCode === TIMED_OUT }
}
