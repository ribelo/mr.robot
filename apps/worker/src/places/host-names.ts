/**
 * The names a Robot calls the Hosts it reaches by (deep review P14b). Two Hosts can share a name: another Member shares a "Desk" with the
 * Space and the owner has a "Desk" too, and `on` matches a name without regard to case. Then each of them goes by its name and its owner's
 * name, "Desk (Anna)" and "Desk (Ben)"; a Host whose name no other Host has keeps it. One owner with two Hosts of one name, or a Host
 * whose own name is already "Desk (Anna)", gets the Host id too: "Desk (Anna, h-…)". The names are unique without regard to case, so `on`
 * finds at most one Host by them, and they hold for as long as the set of Hosts does.
 */

/** What naming a Host needs to know of it. */
export interface NamedHost {
  readonly id: string
  readonly name: string
  readonly ownerName: string
}

const nameKey = (name: string): string => name.toLowerCase()

function countNames(names: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(nameKey(name), (counts.get(nameKey(name)) ?? 0) + 1)
  return counts
}

/** The Hosts, each with the name the Robot calls it by, in the same order. */
export function withDistinctNames<H extends NamedHost>(hosts: readonly H[]): H[] {
  const own = countNames(hosts.map((host) => host.name))
  const shared = (host: NamedHost): boolean => (own.get(nameKey(host.name)) ?? 0) > 1
  const kept = new Set(hosts.filter((host) => !shared(host)).map((host) => nameKey(host.name)))
  const withOwner = (host: NamedHost): string => `${host.name} (${host.ownerName})`
  const owned = countNames(hosts.filter(shared).map(withOwner))
  const distinct = (host: NamedHost): string => {
    if (!shared(host)) return host.name
    const named = withOwner(host)
    return owned.get(nameKey(named)) === 1 && !kept.has(nameKey(named)) ? named : `${host.name} (${host.ownerName}, ${host.id})`
  }
  return hosts.map((host) => ({ ...host, name: distinct(host) }))
}

/** What a name the Robot gives finds among the Hosts it reaches. */
export type HostLookup<H> =
  /** The Host with this id, or with this name as the Robot calls it. */
  | { readonly kind: 'found'; readonly host: H }
  /** More than one Host has this name of its own: `names` are the names the Robot calls them by. */
  | { readonly kind: 'shared'; readonly names: readonly string[] }
  /** No Host goes by this name: `names` are the names the Robot can use. */
  | { readonly kind: 'unknown'; readonly names: readonly string[] }

/** The Host a call names by id or by the name the Robot calls it (withDistinctNames), without regard to case; found with that name. */
export function lookUpHost<H extends NamedHost>(hosts: readonly H[], on: string): HostLookup<H> {
  const named = withDistinctNames(hosts)
  const found = named.find((host) => host.id === on) ?? named.find((host) => nameKey(host.name) === nameKey(on))
  if (found !== undefined) return { kind: 'found', host: found }
  const sharing = named.filter((_, at) => {
    const own = hosts[at]
    return own !== undefined && nameKey(own.name) === nameKey(on)
  })
  return sharing.length > 1 ? { kind: 'shared', names: sharing.map((host) => host.name) } : { kind: 'unknown', names: named.map((host) => host.name) }
}
