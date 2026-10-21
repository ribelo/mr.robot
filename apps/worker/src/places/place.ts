/**
 * Places (v1.16 ticket 01, v1.21): where a tool acts. Every call names one with a mandatory `on`: the Robot's Files in R2 ("files",
 * files only), its Workspace ("workspace": a Host and a directory there, cw-6xs7), its Box, or one of its owner's Hosts by name. A Host is
 * found among the Hosts the Robot's owner reaches; a call to a place the Robot holds no grant on is refused with the grant named (ob-dyg4,
 * ob-qnf7). "workspace" from a Robot that has no Workspace is the old name of "files" and goes there for one release, with a notice.
 */
import type { HostView } from '@mr-robot/protocol'
import { MEMBER_FILE_NAMES } from '../member/member.ts'
import { docsChildren, isDocsPath, productDoc } from '../docs/index.ts'
import { normalizePath } from '../workspace/workspace.ts'
import { BadCall, OwnedPath } from './errors.ts'
import { hostPlace, type StoredPlace } from './host-facet.ts'

export type { Reach } from './host-facet.ts'

export const FILES_PLACE = 'files'
export const WORKSPACE_PLACE = 'workspace'
export const BOX_PLACE = 'box'

/** What a Robot without a Workspace is told when it names "workspace" (cw-shlm): the call went to its Files. */
export const WORKSPACE_ALIAS_NOTICE = 'on "workspace" now names a Workspace on a computer, and you have none: this call went to your Files. Use on "files" for your files in R2.'

/** A place a call resolved to, after its grant was checked. A Host is the one the Robot's owner reaches, as the Space lists it. */
export type Place =
  | { readonly kind: 'files' }
  | { readonly kind: 'box' }
  /** A Host; `workspace` when the call named the Robot's Workspace there, with the current directory a relative path starts in. */
  | { readonly kind: 'host'; readonly host: HostView; readonly workspace?: { readonly cwd: string } }

/** A place that runs commands and holds jobs. */
export type JobsPlace = Exclude<Place, { kind: 'files' }>

/** What a Host facet lets a tool do: files for the file tools and copy, shell for run and the jobs. */
export type PlaceFacet = 'files' | 'shell'

export function storedPlace(place: JobsPlace): StoredPlace {
  return place.kind === 'box' ? 'box' : hostPlace(place.host.id)
}

/** What the Robot sees of a place in a result: files, workspace, box or the Host's name. */
export function placeName(place: Place): string {
  return place.kind === 'host' ? (place.workspace === undefined ? place.host.name : WORKSPACE_PLACE) : place.kind
}

/** The `on` of a call: a non-empty string. Whether it names a place the Robot may use is decided against its grants (Places.resolve). */
export function parseOn(on: unknown, tool: string): string {
  if (typeof on !== 'string' || on.trim() === '') throw new BadCall({ tool, message: `${tool}: parameter "on" is required: files, workspace, box or the name of one of your owner's computers.` })
  return on.trim()
}

/**
 * A path the platform owns in the Workspace: the owner's Member files and the product docs and platform skills that ship with the Worker
 * (ob-pfcu). Only the Workspace reaches them; the Box and a Host refuse the same names so that a Robot does not mistake its own
 * disk for them.
 */
export function ownedPath(path: string): boolean {
  const relative = path.replace(/^\/workspace\/?/, '')
  const key = normalizePath(relative)
  if (key === undefined) return false
  if ((MEMBER_FILE_NAMES as readonly string[]).includes(key)) return true
  return isDocsPath(key) && (productDoc(key) !== undefined || docsChildren(key) !== undefined)
}

/** Refuse a path the platform owns, for a place that is not the Workspace. */
export function refuseOwned(path: string): void {
  if (ownedPath(path)) throw new OwnedPath({ path, message: `${path} is a file the platform keeps in your Files (your owner's files, the product docs and the platform skills). It is reachable only with on "files".` })
}
