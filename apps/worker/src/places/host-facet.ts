/**
 * The names a Host's facets and jobs go by, built and split in one place: the grant item of a Host facet ("<hostId>:files") and the place a
 * job is stored under ("box" or "host:<hostId>").
 */
import * as Schema from 'effect/Schema'

/** What a Host facet lets a tool do: files for the file tools and copy, shell for run and the jobs; browser is the Host's Chrome. */
export type HostFacet = 'files' | 'shell' | 'browser'

/**
 * How far a call on a Host reaches. `granted` is what the grant's mode and roots say; `escalated` is a call the owner approved to run
 * without the sandbox, once (ob-ifak), which never changes the grant.
 */
export type Reach = 'granted' | 'escalated'

/** The grant item name of a Host facet. */
export const hostFacetKey = (hostId: string, facet: HostFacet): string => `${hostId}:${facet}`

/** The Host and facet a grant item name stands for, or undefined when the name is not a Host facet. */
export function splitHostFacet(key: string): { readonly hostId: string; readonly facet: HostFacet } | undefined {
  const at = key.lastIndexOf(':')
  const facet = key.slice(at + 1)
  return at > 0 && (facet === 'files' || facet === 'shell' || facet === 'browser') ? { hostId: key.slice(0, at), facet } : undefined
}

/** The name of a job's place as the store keeps it: "box" or "host:<id>". */
export const StoredPlace = Schema.Union([Schema.Literal('box'), Schema.TemplateLiteral(['host:', Schema.String])])
export type StoredPlace = typeof StoredPlace.Type

/** The stored name of a Host. */
export const hostPlace = (hostId: string): StoredPlace => `host:${hostId}`

/** The Host a stored place names; undefined for the Box. */
export const hostIdOfPlace = (place: StoredPlace): string | undefined => (place === 'box' ? undefined : place.slice('host:'.length))
