/**
 * Mr. Robot as his owner's deputy (v1.6 cd-*): reads and non-dangerous writes on the Robots the owner
 * reaches, as Effect programs over the Robot Durable Object they run in. Every read and write goes
 * through the target Robot's own methods, the ones the PWA's edge API calls; there is no second path.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { DeputySettingsPatch, type ConversationPage, type RobotSettings, type SettingsPatch } from '@mr-robot/protocol'
import type { DeputyHost, RobotListing, RoutineChange } from '../agent/tools/deputy.ts'
import { HOME_ID } from '../env.ts'
import { invalid } from '../platform/durable.ts'
import { normalizePath } from '../workspace/workspace.ts'
import { modelRefusal } from './model-choice.ts'
import { RobotPlatform, RobotState } from './programs.ts'

/** Files a deputy writes stay within what the owner can edit in the app. */
const MAX_FILE_BYTES = 256 * 1024

const promise = <A>(run: () => Promise<A>) => Effect.promise(run)

const config = Effect.gen(function* () {
  const value = (yield* RobotState).config()
  if (value === undefined) return yield* invalid('robot is not initialised')
  return value
})

/**
 * The Robot a deputy call is about. Mr. Robot only; never himself, never another Mr. Robot; the owner must
 * reach the target (the check robot_propose_grants makes). A change also needs the owner to own it,
 * as in the app: a Robot someone else shared with the Home can be read, not changed.
 */
const target = (robotId: string, change: boolean) => Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot is a deputy')
  if (robotId === current.id) return yield* invalid('the deputy tools are for the other Robots, not for you')
  const home = platform.env.HOME.getByName(HOME_ID)
  const access = yield* promise(() => home.access(current.ownerId, robotId))
  const entry = access === null ? undefined : yield* promise(() => home.entry(robotId))
  if (access === null || entry === undefined || entry.kind !== 'robot') return yield* invalid(`no Robot ${robotId} your owner can reach`)
  if (change && access !== 'owner') return yield* invalid(`${entry.identity.name} belongs to someone else in the Home: you may read it, only its owner changes it`)
  return { current, entry, by: current.identity.name, robot: platform.env.ROBOT.getByName(robotId) }
})

export const list = Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot is a deputy')
  const reachable = (yield* promise(() => platform.env.HOME.getByName(HOME_ID).reachable(current.ownerId))).filter((robot) => robot.kind === 'robot')
  return yield* Effect.forEach(reachable, (robot) => Effect.map(
    promise(() => platform.env.ROBOT.getByName(robot.id).settings().then((settings) => settings.model, () => null)),
    (model): RobotListing => ({
      id: robot.id, name: robot.identity.name, title: robot.identity.title, description: robot.identity.description, kind: robot.kind,
      status: robot.status, fleetState: robot.fleetState, model, lastActiveAt: robot.lastAt, lastLine: robot.lastLine,
      owner: robot.ownerName, mine: robot.ownerId === current.ownerId,
    }),
  ), { concurrency: 5 })
})

export const conversation = (robotId: string, page: number) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  return yield* promise((): Promise<ConversationPage> => robot.conversationPage(page))
})
export const searchConversation = (robotId: string, query: string, page: number) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  return yield* promise(() => robot.searchConversation(query, page))
})
export const trajectory = (robotId: string, itemId: string, before: number, after: number) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  return yield* promise(() => robot.trajectoryAround(itemId, before, after))
})
export const files = (robotId: string) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  return yield* promise(() => robot.files())
})

const workspacePath = (path: string) => {
  const normalized = normalizePath(path)
  return normalized === undefined ? invalid(`"${path}" is outside the Workspace`) : Effect.succeed(normalized)
}

export const fileRead = (robotId: string, path: string) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  const normalized = yield* workspacePath(path)
  return yield* promise(() => robot.fileContent(normalized))
})
export const grants = (robotId: string) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  const [settings, openProposals] = yield* promise(() => Promise.all([robot.settings(), robot.openProposals()]))
  return { grants: settings.grants, openProposals }
})
export const routines = (robotId: string) => Effect.gen(function* () {
  const { robot } = yield* target(robotId, false)
  return yield* promise(() => robot.routineList())
})
export const settings = (robotId: string) => Effect.gen(function* () {
  const { current, robot } = yield* target(robotId, false)
  const platform = yield* RobotPlatform
  const [shown, models] = yield* promise(() => Promise.all([robot.settings(), platform.env.HOME.getByName(HOME_ID).models(current.ownerId)]))
  return { settings: shown, models: models.map((option) => ({ provider: option.provider, model: option.model, label: option.label })) }
})

// ------------------------------------------------------------------ changes

export const fileWrite = (robotId: string, path: string, content: string) => Effect.gen(function* () {
  const { robot, by } = yield* target(robotId, true)
  const normalized = yield* workspacePath(path)
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) return yield* invalid('files up to 256 KB can be written this way')
  const saved = yield* promise(() => robot.saveFile(normalized, content, by))
  return { path: normalized, size: saved.size }
})
export const fileDelete = (robotId: string, path: string) => Effect.gen(function* () {
  const { robot, by } = yield* target(robotId, true)
  const normalized = yield* workspacePath(path)
  yield* promise(() => robot.deleteFile(normalized, by))
  return { deleted: normalized }
})

const FORBIDDEN: Record<string, string> = {
  grants: 'Grants stay with your owner: propose them with robot_propose_grants',
  spendLimitUsd: 'the spend limit stays with your owner',
  sharing: 'who a Robot is shared with stays with your owner',
  identity: 'use robot_configure for name, title, description and avatar colour',
}

/** The deputy's settings patch: only what DeputySettingsPatch lists decodes; grants, spend limit and sharing are refused by name. */
export const settingsSet = (robotId: string, input: unknown) => Effect.gen(function* () {
  const { current, robot, by } = yield* target(robotId, true)
  const platform = yield* RobotPlatform
  const keys = typeof input === 'object' && input !== null ? Object.keys(input) : []
  const refused = keys.filter((key) => key in FORBIDDEN)
  if (refused.length > 0) return yield* invalid(refused.map((key) => `${key}: ${FORBIDDEN[key]}`).join('; '))
  const patch = yield* Schema.decodeUnknownEffect(DeputySettingsPatch)(input, { onExcessProperty: 'error' }).pipe(
    Effect.mapError((error) => invalid(`these settings cannot be changed this way: ${String(error)}`)),
  )
  const shown: RobotSettings = yield* promise(() => robot.settings())
  const model = patch.model === undefined && patch.thinking === undefined ? undefined : {
    provider: patch.model?.provider ?? shown.model.provider, model: patch.model?.model ?? shown.model.model, effort: patch.thinking ?? shown.model.effort,
  }
  if (model !== undefined) {
    const refusal = yield* promise(() => modelRefusal(platform.env, current.ownerId, shown.model, model))
    if (refusal !== null) return yield* invalid(refusal)
  }
  const change: SettingsPatch = {
    ...(model === undefined ? {} : { model }),
    ...(patch.codeMode === undefined ? {} : { codeMode: patch.codeMode }),
    ...(patch.contextBudget === undefined ? {} : { contextBudget: patch.contextBudget }),
    ...(patch.compactionInstruction === undefined ? {} : { compactionInstruction: patch.compactionInstruction }),
    ...(patch.discordChannel === undefined ? {} : { discordChannel: patch.discordChannel }),
    ...(patch.discordProactive === undefined ? {} : { discordProactive: patch.discordProactive }),
    ...(patch.browserBackend === undefined ? {} : { browserBackend: patch.browserBackend }),
    ...(patch.wakeOnScreenNotifications === undefined ? {} : { wakeOnScreenNotifications: patch.wakeOnScreenNotifications }),
    ...(patch.notifications === undefined ? {} : { notifications: {
      enabled: patch.notifications.enabled ?? shown.notifications.enabled,
      members: shown.notifications.members,
      channels: patch.notifications.channels ?? shown.notifications.channels,
    } }),
  }
  return yield* promise(() => robot.updateSettings(change, by))
})

/** robot_configure: the whole identity (cd-28og). */
export const configure = (robotId: string, change: { name?: string; title?: string; description?: string; avatarColor?: string }) => Effect.gen(function* () {
  const { entry, robot, by } = yield* target(robotId, true)
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => typeof value === 'string' && value.trim() !== ''))
  if (typeof given['avatarColor'] === 'string' && !/^#[0-9a-fA-F]{6}$/.test(given['avatarColor'])) return yield* invalid('avatarColor is #rrggbb')
  const settings = yield* promise(() => robot.updateSettings({ identity: { ...entry.identity, ...given } }, by))
  return { id: robotId, identity: settings.identity as unknown }
})

export const routineSet = (robotId: string, change: RoutineChange) => Effect.gen(function* () {
  const { robot, by } = yield* target(robotId, true)
  return yield* promise(() => robot.setRoutine(change, by))
})
export const routinePause = (robotId: string, id: string, paused: boolean) => Effect.gen(function* () {
  const { robot, by } = yield* target(robotId, true)
  return yield* promise(() => robot.pauseRoutine(id, paused, by))
})
export const routineDelete = (robotId: string, id: string) => Effect.gen(function* () {
  const { robot, by } = yield* target(robotId, true)
  yield* promise(() => robot.removeRoutine(id, by))
  return { deleted: id }
})

type Run = <A>(program: Effect.Effect<A, { readonly _tag: string; readonly message: string }, RobotState | RobotPlatform>) => Promise<A>

/** The host the deputy tools call, each method one of the programs above run in the Robot Durable Object. */
/** Results that crossed Workers RPC carry stubs' bookkeeping; the model's tools get plain JSON. */
const plain = async <A>(result: Promise<A>): Promise<A> => JSON.parse(JSON.stringify(await result)) as A

export function deputyHost(run: Run): DeputyHost {
  return {
    list: () => plain(run(list)),
    conversation: (id, page) => plain(run(conversation(id, page))),
    searchConversation: (id, query, page) => plain(run(searchConversation(id, query, page))),
    trajectory: (id, item, before, after) => plain(run(trajectory(id, item, before, after))),
    files: (id) => plain(run(files(id))),
    fileRead: (id, path) => plain(run(fileRead(id, path))),
    grants: (id) => plain(run(grants(id))),
    routines: (id) => plain(run(routines(id))),
    settings: (id) => plain(run(settings(id))),
    fileWrite: (id, path, content) => plain(run(fileWrite(id, path, content))),
    fileDelete: (id, path) => plain(run(fileDelete(id, path))),
    settingsSet: (id, patch) => plain(run(settingsSet(id, patch))),
    routineSet: (id, change) => plain(run(routineSet(id, change))),
    routinePause: (id, routine, paused) => plain(run(routinePause(id, routine, paused))),
    routineDelete: (id, routine) => plain(run(routineDelete(id, routine))),
  }
}
