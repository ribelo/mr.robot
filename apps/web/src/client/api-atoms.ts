/**
 * The web app's state in Effect Atom (fe-2hh0): query atoms read through MrRobotApi and refresh
 * when a command or the live feed invalidates their keys; commands go through one atom.
 */
import { useAtomSet } from '@effect/atom-react'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import { Atom, Reactivity } from 'effect/reactivity'
import { useCallback } from 'react'
import type { ApiFailure } from './api-failure.ts'
import { MrRobotApi } from './mr-robot-api.ts'

/** The runtime every API atom runs in: the API service (Reactivity comes with the runtime). */
export const apiRuntime = Atom.runtime(MrRobotApi.layer)

/** Refresh keys: what a command changed, so the atoms showing it read it again. */
export const keys = {
  me: 'me',
  robots: 'robots',
  groups: 'groups',
  robot: (id: string) => `robot:${id}`,
  files: (id: string) => `files:${id}`,
  admin: 'admin',
  providers: 'providers',
  secrets: 'secrets',
  hosts: 'hosts',
  memberFiles: 'member-files',
  homeMemory: 'home-memory',
  plugins: 'plugins',
  connections: 'connections',
  tasks: 'tasks',
} as const

type Read<A> = (api: MrRobotApi['Service']) => Effect.Effect<A, ApiFailure>

const withApi = <A,>(read: Read<A>): Effect.Effect<A, ApiFailure, MrRobotApi> => Effect.gen(function* () {
  return yield* read(yield* MrRobotApi)
})

/** A query atom: runs read against the API and reads again whenever one of its keys is invalidated. */
function query<A>(read: Read<A>, refreshOn: ReadonlyArray<string>) {
  return apiRuntime.atom(withApi(read)).pipe(Atom.withReactivity(refreshOn))
}

export const meAtom = query((api) => api.me, [keys.me])
export const robotsAtom = query((api) => api.robots, [keys.robots])
export const groupsAtom = query((api) => api.robotGroups, [keys.groups])
/** Keyed "<robot id>" or "<robot id>|details" (Work details above Compact, pl-6eir). */
export const conversationAtom = Atom.family((key: string) => {
  const [id = '', details] = key.split('|')
  return query((api) => api.conversation(id, details === 'details'), [keys.robot(id)])
})
export const panelAtom = Atom.family((id: string) => query((api) => api.panel(id), [keys.robot(id)]))
export const catalogAtom = Atom.family((id: string) => query((api) => api.catalog(id), [keys.robot(id)]))
export const promptAtom = Atom.family((id: string) => query((api) => api.prompt(id), [keys.robot(id)]))
export const webhookAtom = Atom.family((id: string) => query((api) => api.webhook(id), [keys.robot(id)]))
export const trajectoryAtom = Atom.family((id: string) => query((api) => api.trajectory(id), [keys.robot(id)]))
export const filesAtom = Atom.family((id: string) => query((api) => api.files(id), [keys.files(id)]))
/** Keyed "<robot id>\n<path>". */
export const fileAtom = Atom.family((key: string) => {
  const [id = '', path = ''] = key.split('\n')
  return query((api) => api.file(id, path), [keys.files(id)])
})
export const memberFileAtom = Atom.family((name: string) => query((api) => api.memberFile(name), [keys.memberFiles]))
export const homeMemoryAtom = query((api) => api.homeMemory, [keys.homeMemory])
export const adminAtom = query((api) => api.admin, [keys.admin])
export const homeSettingsAtom = query((api) => api.homeSettings, [keys.admin])
export const providersAtom = query((api) => api.providers, [keys.providers])
export const secretsAtom = query((api) => api.secrets, [keys.secrets])
export const hostsAtom = query((api) => api.hosts, [keys.hosts])
export const hostActionsAtom = Atom.family((hostId: string) => query((api) => api.hostActions(hostId), [keys.hosts]))
export const pairingAtom = Atom.family((code: string) => query((api) => api.pairing(code), [keys.hosts]))
export const pluginsAtom = query((api) => api.plugins, [keys.plugins])
export const connectionsAtom = query((api) => api.connections, [keys.connections])
export const connectionNotesAtom = query((api) => api.connectionNotes, [keys.connections])
export const homeMembersAtom = query((api) => api.homeMembers, [keys.me])
/** What Mission Control shows: its filters, and how many pages of each table are loaded. */
export interface MissionQuery {
  readonly scope: 'mine' | 'home'
  readonly state: string
  readonly group: string
  readonly q: string
  readonly fleetPages: number
  readonly taskPages: number
}

/**
 * Mission Control's tables, keyed by a MissionQuery as JSON: the first `fleetPages` and `taskPages` pages, read
 * from the server one page at a time and joined (mc-m3cc). Robots and Tasks changing make it read again.
 */
export const missionAtom = Atom.family((key: string) => {
  const wanted = JSON.parse(key) as MissionQuery
  return query((api) => Effect.gen(function* () {
    const base = new URLSearchParams({ scope: wanted.scope, state: wanted.state, group: wanted.group, q: wanted.q })
    const first = yield* api.mission(base.toString())
    let view = first
    for (let page = 2; page <= Math.max(wanted.fleetPages, wanted.taskPages); page += 1) {
      const more = new URLSearchParams(base)
      more.set('fleetPage', String(Math.min(page, wanted.fleetPages)))
      more.set('taskPage', String(Math.min(page, wanted.taskPages)))
      const next = yield* api.mission(more.toString())
      view = {
        ...next,
        fleet: page <= wanted.fleetPages && view.fleetNext !== null ? [...view.fleet, ...next.fleet] : view.fleet,
        fleetNext: page <= wanted.fleetPages ? next.fleetNext : view.fleetNext,
        tasks: page <= wanted.taskPages && view.tasksNext !== null ? [...view.tasks, ...next.tasks] : view.tasks,
        tasksNext: page <= wanted.taskPages ? next.tasksNext : view.tasksNext,
      }
    }
    return view
  }), [keys.robots, keys.tasks])
})

/** Keyed by the list's query string ("state=all&parent=t-…"). */
export const tasksAtom = Atom.family((search: string) => query((api) => api.tasks(search), [keys.tasks]))
export const taskAtom = Atom.family((id: string) => query((api) => api.task(id), [keys.tasks]))
export const skillAtom = Atom.family((name: string) => query((api) => api.skill(name), [keys.admin]))

/** A change to make through the API, and the keys whose atoms must read again after it succeeds. */
interface Command {
  readonly run: Read<unknown>
  readonly invalidates: ReadonlyArray<string>
}

const commandAtom = apiRuntime.fn((command: Command) =>
  withApi(command.run).pipe(Reactivity.mutation(command.invalidates)), { concurrent: true })

/**
 * Run API commands from a component (fe-2hh0): the promise resolves with the Exit, so an expected
 * failure is a value the caller renders, never a thrown exception.
 */
export function useCommand(): <A>(run: Read<A>, invalidates: ReadonlyArray<string>) => Promise<Exit.Exit<A, ApiFailure>> {
  const execute = useAtomSet(commandAtom, { mode: 'promiseExit' })
  return useCallback(<A,>(run: Read<A>, invalidates: ReadonlyArray<string>) =>
    // SAFETY: the command atom returns exactly what run returned; the atom is typed with unknown only because one atom serves every command.
    execute({ run, invalidates }) as Promise<Exit.Exit<A, ApiFailure>>, [execute])
}
