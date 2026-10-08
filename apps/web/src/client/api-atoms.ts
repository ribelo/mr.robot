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
  robot: (id: string) => `robot:${id}`,
  files: (id: string) => `files:${id}`,
  admin: 'admin',
  providers: 'providers',
  secrets: 'secrets',
  hosts: 'hosts',
  memberFiles: 'member-files',
  homeMemory: 'home-memory',
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
/** Keyed "<robot id>" or "<robot id>|details" (Work details above Compact, pl-6eir). */
export const conversationAtom = Atom.family((key: string) => {
  const [id = '', details] = key.split('|')
  return query((api) => api.conversation(id, details === 'details'), [keys.robot(id)])
})
export const panelAtom = Atom.family((id: string) => query((api) => api.panel(id), [keys.robot(id)]))
export const catalogAtom = Atom.family((id: string) => query((api) => api.catalog(id), [keys.robot(id)]))
export const promptAtom = Atom.family((id: string) => query((api) => api.prompt(id), [keys.robot(id)]))
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
export const opencodeKeysAtom = query((api) => api.opencodeKeys, [keys.providers])
export const secretsAtom = query((api) => api.secrets, [keys.secrets])
export const hostsAtom = query((api) => api.hosts, [keys.hosts])
export const hostActionsAtom = Atom.family((hostId: string) => query((api) => api.hostActions(hostId), [keys.hosts]))
export const pairingAtom = Atom.family((code: string) => query((api) => api.pairing(code), [keys.hosts]))
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
