/**
 * A Robot that waits for its Hosts (v1.16 ticket 05, ob-5nvd): what a due Task does while a Host of its Robot is
 * offline. Pure functions; the Robot's alarm and the Host's online event call them (programs.ts).
 *
 * The Robot's Hosts are those it holds any facet on (files, shell or browser, at allow or ask); Mr. Robot's are only those his owner
 * raised a facet on (taskHostFacets). Only a Task Wake-up is held back; a message of the owner or of another Robot always wakes the
 * Robot (ob-amlz).
 */
import { usableNames, type GrantLevel, type GrantLevels } from '@mr-robot/protocol'
import { splitHostFacet } from '../places/host-facet.ts'
import { mrRobotHostLevel } from './host-access.ts'

/** A Host as the Home lists it for the Robot's owner. */
export interface KnownHost {
  readonly id: string
  readonly name: string
  readonly online: boolean
}

/** A due Task, as far as the gate cares: whether it recurs, and the deadline of a scheduled one. */
export interface GatedTask {
  readonly recurring: boolean
  readonly deadline: number | null
}

const LEVEL_RANK: Readonly<Record<GrantLevel, number>> = { deny: 0, ask: 1, allow: 2 }

/**
 * The Host facets that count for the setting, from the Robot's stored grant rows alone, so they hold after a restart: an ordinary
 * Robot's rows; for Mr. Robot only the facets his owner raised above where he starts (files or shell at allow). He holds every Host his
 * owner reaches without a row, other Members' shared Hosts too; counting those would let any offline Host stop all his Tasks.
 */
export function taskHostFacets(kind: 'mr-robot' | 'robot', stored: GrantLevels): GrantLevels {
  if (kind === 'robot') return stored
  return Object.fromEntries(Object.entries(stored).filter(([facet, level]) => LEVEL_RANK[level] > LEVEL_RANK[mrRobotHostLevel(facet)]))
}

/** The Hosts the Robot holds a facet on: "<hostId>:files", "<hostId>:shell" or "<hostId>:browser" at allow or ask. */
export function heldHosts(facets: GrantLevels, known: readonly KnownHost[]): KnownHost[] {
  const held = new Set(usableNames(facets).flatMap((facet) => splitHostFacet(facet)?.hostId ?? []))
  return known.filter((host) => held.has(host.id))
}

export type TaskGate =
  /** Start the Turn. */
  | { readonly kind: 'run' }
  /** End the Attempt as failed with this line, without a Turn. */
  | { readonly kind: 'fail'; readonly line: string; readonly offline: readonly KnownHost[] }
  /** Keep the Wake-up until a Host comes back or the deadline passes. */
  | { readonly kind: 'park'; readonly offline: readonly KnownHost[] }

const named = (hosts: readonly KnownHost[]): string =>
  hosts.length === 1 ? `Host "${hosts[0]!.name}" is offline` : `Hosts ${hosts.map((host) => `"${host.name}"`).join(', ')} are offline`

/**
 * What a due Task does now. Setting off, or every held Host online: it runs. A recurring Task with a Host offline
 * fails at once (the next occurrence is its next chance). A scheduled Task parks, unless its deadline passed:
 * then it fails (ob-qgpy, ob-e271).
 */
export function gateTask(input: { readonly requiresHosts: boolean; readonly task: GatedTask; readonly held: readonly KnownHost[]; readonly now: number }): TaskGate {
  const offline = input.held.filter((host) => !host.online)
  if (!input.requiresHosts || offline.length === 0) return { kind: 'run' }
  if (input.task.recurring) return { kind: 'fail', line: `${named(offline)}; this occurrence did not run.`, offline }
  if (input.task.deadline !== null && input.now >= input.task.deadline) return { kind: 'fail', line: `${named(offline)}; the deadline passed before it came back.`, offline }
  return { kind: 'park', offline }
}

/** The owner's notification for a failed Task: the Hosts still unreported in this outage, or none (once per outage). */
export function outageNotice(offline: readonly KnownHost[], reported: readonly string[]): { readonly fresh: readonly KnownHost[]; readonly reported: readonly string[] } {
  const fresh = offline.filter((host) => !reported.includes(host.id))
  return { fresh, reported: [...reported, ...fresh.map((host) => host.id)] }
}

/** Hosts that came back leave the reported list: the next outage tells the owner again. */
export function afterReturn(reported: readonly string[], known: readonly KnownHost[]): readonly string[] {
  return reported.filter((id) => known.some((host) => host.id === id && !host.online))
}
