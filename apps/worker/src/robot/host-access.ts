/**
 * What a Robot may do on a Host (v1.16 ticket 02, ob-wh59, ob-397e): the mode and write roots of each Host facet grant, and the name of
 * the Robot's own directory on every Host. Pure; the Robot DO keeps the values and the Host app enforces them.
 */
import * as Data from 'effect/Data'
import * as Result from 'effect/Result'
import { DEFAULT_HOST_GRANT_ACCESS, isHostRoot, type GrantLevel, type HostAccessByFacet, type HostGrantAccess } from '@mr-robot/protocol'
import type { GrantItem } from '../agent/ask-gate.ts'
import { splitHostFacet } from '../places/host-facet.ts'

/** The Robot's keys for them: the access map by facet, and the directory name chosen at first use. */
export const HOST_ACCESS = 'host-access'
export const HOST_DIRECTORY = 'host-directory'

/** The most roots one grant lists: a short list a person reads. */
export const MAX_HOST_ROOTS = 20

/** An access map the Robot refuses to keep. */
export class InvalidHostAccess extends Data.TaggedError('InvalidHostAccess')<{ readonly message: string }> {}

/**
 * A root as written, for comparing two of them: its anchor (~, /, or a drive) and its directory names, with . and .. taken away. Case is
 * ignored, as macOS and Windows ignore it: two roots that differ only in case are taken for one directory.
 */
function rootParts(root: string): string[] {
  const parts: string[] = []
  for (const part of root.toLowerCase().split(/[\\/]+/).slice(1)) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  const anchor = root.startsWith('~') ? '~' : /^[A-Za-z]:/.test(root) ? root.slice(0, 2).toLowerCase() : ''
  return [anchor, ...parts]
}

/** Whether `inner` lies strictly inside `outer`, both as rootParts gives them. */
const strictlyInside = (outer: readonly string[], inner: readonly string[]): boolean => inner.length > outer.length && outer.every((part, at) => part === inner[at])

/**
 * Why the roots of one grant cannot be confined, or undefined (deep review P1b): the sandbox follows a link at a root, so a root that lies
 * inside another root, inside the Robot's own directory, or that holds that directory, could be swapped for a link by the Robot. Compared
 * as written; a root written as an absolute path inside the home directory is caught by the Host app, which compares real paths.
 */
function nestedRoot(roots: readonly string[], robotDirectory: string): string | undefined {
  const directory = `~/mr-robot/${robotDirectory}`
  const named: ReadonlyArray<readonly [string, string[]]> = [[`the Robot's own directory ${directory}`, rootParts(directory)], ...roots.map((root) => [`"${root}"`, rootParts(root)] as const)]
  for (const [innerName, inner] of named) {
    const outer = named.find(([, candidate]) => strictlyInside(candidate, inner))
    if (outer !== undefined) return `${innerName} lies inside ${outer[0]}: no write root may lie inside another, inside the Robot's own directory (${directory}), or hold it, because the Robot could put a link in its place and the sandbox would follow it`
  }
  return undefined
}

/**
 * The temporary directories a command in the sandbox may change on some Host (Landlock grants the real /tmp) or that every user may write
 * (deep review P1c). The Host app checks the ones its own sandbox grants, by real path.
 */
const TEMP_DIRECTORIES = ['/tmp', '/var/tmp', '/dev/shm']

/** Why a root lies inside a temporary directory, or undefined: a command could put a link in its place before the next call. */
function rootInTemp(roots: readonly string[]): string | undefined {
  for (const root of roots) {
    const temp = TEMP_DIRECTORIES.find((directory) => strictlyInside(rootParts(directory), rootParts(root)))
    if (temp !== undefined) return `"${root}" lies inside ${temp}: no write root may lie inside ${TEMP_DIRECTORIES.join(', ')}, because a command in the sandbox may change it and could put a link in the root's place`
  }
  return undefined
}

/**
 * A request's access map as the Robot keeps it: roots trimmed and without duplicates, defaults left out. A bad root is the error, and so
 * is a root nested in another or in the Robot's directory (`robotDirectory`, its name under ~/mr-robot/), or one in a temporary directory.
 */
export function parseHostAccess(input: HostAccessByFacet, robotDirectory: string): Result.Result<HostAccessByFacet, InvalidHostAccess> {
  const access: Record<string, HostGrantAccess> = {}
  for (const [facet, given] of Object.entries(input)) {
    const split = splitHostFacet(facet)
    if (split === undefined || split.facet === 'browser') return Result.fail(new InvalidHostAccess({ message: `"${facet}" is not a files or shell grant of a Host` }))
    const roots = [...new Set(given.roots.map((root) => root.trim()).filter((root) => root !== ''))]
    const bad = roots.find((root) => !isHostRoot(root))
    if (bad !== undefined) return Result.fail(new InvalidHostAccess({ message: `"${bad}" is not a directory on a computer: write an absolute path or one that starts with ~/` }))
    if (roots.length > MAX_HOST_ROOTS) return Result.fail(new InvalidHostAccess({ message: `a grant lists at most ${MAX_HOST_ROOTS} write roots` }))
    const confinable = nestedRoot(roots, robotDirectory) ?? rootInTemp(roots)
    if (confinable !== undefined) return Result.fail(new InvalidHostAccess({ message: confinable }))
    if (given.mode !== DEFAULT_HOST_GRANT_ACCESS.mode || roots.length > 0) access[facet] = { mode: given.mode, roots }
  }
  return Result.succeed(access)
}

/** The access of one Host facet: what its grant names, else the default. */
export const hostAccessOf = (stored: HostAccessByFacet | undefined, facet: string): HostGrantAccess => stored?.[facet] ?? DEFAULT_HOST_GRANT_ACCESS

/**
 * The level of a Host facet for Mr. Robot until his owner changes it (v1.16 ticket 09, ob-2k5x): files and shell at ask, so the chief does
 * not act on the owner's disk unasked, on every Host he reaches, a shared one included; his browser at allow.
 */
export const mrRobotHostLevel = (facet: string): GrantLevel => (splitHostFacet(facet)?.facet === 'browser' ? 'allow' : 'ask')

/** The Hosts that the Host facets among a call's grant items name: a tool-call Ask on one of them is shown on that computer (ob-6jr5). */
export function hostIdsOf(items: readonly GrantItem[]): string[] {
  return [...new Set(items.flatMap((item) => (item.kind === 'host' ? [splitHostFacet(item.name)?.hostId ?? []].flat() : [])))]
}

/** The Hosts the Host facets among a call's grant items name, in the order the call names them, a Host named twice twice (deep review P14). */
export function hostsInOrder(items: readonly GrantItem[]): string[] {
  return items.flatMap((item) => {
    const hostId = item.kind === 'host' ? splitHostFacet(item.name)?.hostId : undefined
    return hostId === undefined ? [] : [hostId]
  })
}

/**
 * Eight hex digits that tell Robots apart in a directory name: FNV-1a (32 bits) over the whole id. The start of the id did not (deep review
 * P8): every Mr. Robot's id starts with mr-robot-, so every Member's Mr. Robot had one directory on a shared Host.
 */
function robotIdHash(id: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < id.length; at += 1) hash = Math.imul(hash ^ id.charCodeAt(at), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * The name of a Robot's directory under mr-robot/ on a Host: its name as it was at first use, made safe for a file name, and a hash of
 * its id so that two Robots with one name do not share a directory. The Robot keeps it, so a rename does not lose its files.
 */
export function robotDirectoryName(name: string, id: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '')
  return `${slug === '' ? 'robot' : slug}-${robotIdHash(id)}`
}

/**
 * The directory name a Mr. Robot keeps once his shared one is given up (deep review P8): a name chosen before v1.16's deep fix ends in
 * -mr-robot, the start of his id, which every Member's Mr. Robot had; it gets the hash of his id in its place. Any other name is kept.
 * The old directory stays on the Hosts.
 */
export function unsharedMrRobotDirectory(kept: string, id: string): string {
  const shared = '-mr-robot'
  return kept.endsWith(shared) ? `${kept.slice(0, -shared.length)}-${robotIdHash(id)}` : kept
}
