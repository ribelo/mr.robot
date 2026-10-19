/**
 * Mr. Robot as his owner's deputy (v1.6 cd-*): reads and non-dangerous writes on the Robots the owner
 * reaches, as Effect programs over the Robot Durable Object they run in. Every read and write goes
 * through the target Robot's own methods, the ones the PWA's edge API calls; there is no second path.
 * The target answers through Robot.forDeputy, which returns an expected failure as a value: a refusal
 * never crosses Workers RPC as an exception (workerd reports every rejected RPC call as uncaught).
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { DeputySettingsPatch, type RobotSettings, type SettingsPatch } from '@mr-robot/protocol'
import type { DeputyHost, HelpListing, RobotListing } from '../agent/tools/deputy.ts'
import { HOME_ID } from '../env.ts'
import { conflict, invalid, notFound, type DurableError } from '../platform/durable.ts'
import { normalizePath } from '../workspace/workspace.ts'
import { modelRefusal } from './model-choice.ts'
import { RobotPlatform, RobotState } from './programs.ts'
import type { Robot } from './robot.ts'

/** Files a deputy writes stay within what the owner can edit in the app. */
const MAX_FILE_BYTES = 256 * 1024

const promise = <A>(run: () => Promise<A>) => Effect.promise(run)

/** The target Robot's methods a deputy call reaches: the ones the PWA's edge API calls, nothing else. */
export const DEPUTY_METHODS = [
  'conversationPage', 'searchConversation', 'trajectoryAround', 'files', 'fileContent', 'settings', 'openProposals',
  'saveFile', 'deleteFile', 'updateSettings',
  // Mr. Robot answers requests for help (sk-gag7): the one answer path open to him, and it refuses every other kind of Ask (sk-iis1).
  // The Ask answer paths (answer, answerToolCall, ...) are not on this list and never will be.
  'answerHelp',
] as const
export type DeputyMethod = (typeof DEPUTY_METHODS)[number]

type Signature<M extends DeputyMethod> = Robot[M] extends (...args: infer P) => infer R ? { readonly args: P; readonly result: Awaited<R> } : never

/** What the target Robot answers a deputy call with: the value, or the expected failure as a value. */
export type DeputyOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly failure: { readonly tag: DurableError['_tag']; readonly message: string } }

const EXPECTED: Record<string, DurableError['_tag']> = { NotFound: 'NotFound', Invalid: 'Invalid', Conflict: 'Conflict', WorkspaceError: 'Invalid', RobotNotFound: 'NotFound' }

/**
 * The target side of a deputy call (Robot.forDeputy): run one of DEPUTY_METHODS and return its result,
 * or its expected failure (NotFound, Invalid, Conflict, a Workspace error) as a value. Anything else is a
 * defect and still throws.
 */
export async function answer(method: string, call: () => unknown): Promise<DeputyOutcome> {
  if (!(DEPUTY_METHODS as readonly string[]).includes(method)) return { ok: false, failure: { tag: 'Invalid', message: `${method} is not open to a deputy` } }
  try {
    return { ok: true, value: await call() }
  } catch (error) {
    const named = error as { _tag?: unknown; name?: unknown; message?: unknown } | null
    const tag = EXPECTED[String(named?._tag ?? named?.name ?? '')]
    if (tag === undefined) throw error
    return { ok: false, failure: { tag, message: typeof named?.message === 'string' ? named.message : String(error) } }
  }
}

const failure = (failed: { readonly tag: DurableError['_tag']; readonly message: string }): DurableError =>
  failed.tag === 'NotFound' ? notFound(failed.message) : failed.tag === 'Conflict' ? conflict(failed.message) : invalid(failed.message)

/** The caller side: one of the target Robot's methods, its expected failures typed in the error channel. */
const ask = <M extends DeputyMethod>(robot: DurableObjectStub<Robot>, method: M, ...args: Signature<M>['args']): Effect.Effect<Signature<M>['result'], DurableError> =>
  Effect.flatMap(
    promise(() => (robot.forDeputy as (method: DeputyMethod, args: readonly unknown[]) => Promise<DeputyOutcome>)(method, args)),
    (outcome) => (outcome.ok ? Effect.succeed(outcome.value as Signature<M>['result']) : Effect.fail(failure(outcome.failure))),
  )

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
/** Also the Robot a Task tool with robot_id works as (v1.13 ticket 04). */
export const reach = (robotId: string, change: boolean) => Effect.gen(function* () {
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
    ask(platform.env.ROBOT.getByName(robot.id), 'settings').pipe(Effect.map((settings) => settings.model), Effect.catch(() => Effect.succeed(null))),
    (model): RobotListing => ({
      id: robot.id, name: robot.identity.name, title: robot.identity.title, description: robot.identity.description, kind: robot.kind,
      status: robot.status, fleetState: robot.fleetState, model, lastActiveAt: robot.lastAt, lastLine: robot.lastLine,
      owner: robot.ownerName, mine: robot.ownerId === current.ownerId,
    }),
  ), { concurrency: 5 })
})

export const conversation = (robotId: string, page: number) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  return yield* ask(robot, 'conversationPage', page)
})
export const searchConversation = (robotId: string, query: string, page: number) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  return yield* ask(robot, 'searchConversation', query, page)
})
export const trajectory = (robotId: string, itemId: string, before: number, after: number) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  return yield* ask(robot, 'trajectoryAround', itemId, before, after)
})
export const files = (robotId: string) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  return yield* ask(robot, 'files')
})

const workspacePath = (path: string) => {
  const normalized = normalizePath(path)
  return normalized === undefined ? invalid(`"${path}" is outside the Workspace`) : Effect.succeed(normalized)
}

export const fileRead = (robotId: string, path: string) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  const normalized = yield* workspacePath(path)
  return yield* ask(robot, 'fileContent', normalized)
})
export const grants = (robotId: string) => Effect.gen(function* () {
  const { robot } = yield* reach(robotId, false)
  const [settings, openProposals] = yield* Effect.all([ask(robot, 'settings'), ask(robot, 'openProposals')])
  return { grants: settings.grants, openProposals }
})
export const settings = (robotId: string) => Effect.gen(function* () {
  const { current, robot } = yield* reach(robotId, false)
  const platform = yield* RobotPlatform
  const [shown, models, accounts] = yield* Effect.all([ask(robot, 'settings'), promise(() => platform.env.HOME.getByName(HOME_ID).models(current.ownerId)), promise(() => platform.env.HOME.getByName(HOME_ID).accountsFor(current.ownerId))])
  return {
    settings: shown,
    models: models.map((option) => ({ provider: option.provider, model: option.model, label: option.label })),
    // What a chain entry may name (pa-w81r): the owner's accounts and those shared with the Home.
    accounts: [...accounts.mine, ...accounts.shared].map((account) => ({ account: account.id, owner: account.ownerId, provider: account.provider, label: account.label, status: account.status })),
  }
})

// ------------------------------------------------------------------ requests for help (sk-cj9v, sk-gag7)

/** Open requests for help of the Robots the owner owns: the ones Mr. Robot's owner answers (a shared Robot's own owner answers, and his Mr. Robot is woken). */
export const helpRequests = Effect.gen(function* () {
  const platform = yield* RobotPlatform
  const current = yield* config
  if (current.kind !== 'mr-robot') return yield* invalid('only Mr. Robot is a deputy')
  const reachable = (yield* promise(() => platform.env.HOME.getByName(HOME_ID).reachable(current.ownerId))).filter((robot) => robot.kind === 'robot' && robot.ownerId === current.ownerId)
  const found = yield* Effect.forEach(reachable, (robot) => ask(platform.env.ROBOT.getByName(robot.id), 'openProposals').pipe(
    Effect.map((open) => open.flatMap((proposal): HelpListing[] => proposal.kind === 'help' && proposal.help !== undefined ? [{
      robot: robot.identity.name, robotId: robot.id, id: proposal.id, created: new Date(proposal.help.created).toISOString(), urgent: proposal.help.urgent,
      escalated: proposal.help.escalated, doing: proposal.help.doing, tried: proposal.help.tried, need: proposal.help.need,
    }] : [])),
    Effect.catch(() => Effect.succeed([] as HelpListing[])),
  ), { concurrency: 5 })
  return found.flat().sort((a, b) => a.created.localeCompare(b.created))
})

/** help_answer: the Robot's own answer path, as Mr. Robot. Its refusals (not a help Ask, already closed) come back as words. */
export const helpAnswer = (robotId: string, requestId: string, text: string) => Effect.gen(function* () {
  const { current, robot } = yield* reach(robotId, true)
  const result = yield* ask(robot, 'answerHelp', requestId, text, { by: 'mr-robot', name: current.identity.name })
  if (result.ok) return { requestId, status: 'answered; the Robot is woken with your answer and the request is closed' }
  switch (result.reason) {
    case 'not-found': return yield* invalid(`no request ${requestId} on that Robot; list them with help_requests`)
    case 'not-help': return yield* invalid(`${requestId} is not a request for help (it is a ${result.kind} Ask); only the owner answers that`)
    case 'empty': return yield* invalid('the answer needs text')
    case 'closed': return yield* conflict(result.answeredBy === 'owner' ? 'your owner already answered this request' : 'this request is already answered')
  }
})

// ------------------------------------------------------------------ changes

export const fileWrite = (robotId: string, path: string, content: string) => Effect.gen(function* () {
  const { robot, by } = yield* reach(robotId, true)
  const normalized = yield* workspacePath(path)
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) return yield* invalid('files up to 256 KB can be written this way')
  const saved = yield* ask(robot, 'saveFile', normalized, content, by)
  return { path: normalized, size: saved.size }
})
export const fileDelete = (robotId: string, path: string) => Effect.gen(function* () {
  const { robot, by } = yield* reach(robotId, true)
  const normalized = yield* workspacePath(path)
  // A file that is not there is not reported to the Robot as deleted.
  yield* ask(robot, 'fileContent', normalized)
  yield* ask(robot, 'deleteFile', normalized, by)
  return { deleted: normalized }
})

const FORBIDDEN: Record<string, string> = {
  grants: 'Grants stay with your owner: propose them with robot_propose_grants',
  spendLimit: 'the spend limit stays with your owner',
  sharing: 'who a Robot is shared with stays with your owner',
  identity: 'use robot_configure for name, title, description and avatar colour',
}

/** The deputy's settings patch: only what DeputySettingsPatch lists decodes; grants, spend limit and sharing are refused by name. */
export const settingsSet = (robotId: string, input: unknown) => Effect.gen(function* () {
  const { current, robot, by } = yield* reach(robotId, true)
  const platform = yield* RobotPlatform
  const keys = typeof input === 'object' && input !== null ? Object.keys(input) : []
  const refused = keys.filter((key) => key in FORBIDDEN)
  if (refused.length > 0) return yield* invalid(refused.map((key) => `${key}: ${FORBIDDEN[key]}`).join('; '))
  const patch = yield* Schema.decodeUnknownEffect(DeputySettingsPatch)(input, { onExcessProperty: 'error' }).pipe(
    Effect.mapError((error) => invalid(`these settings cannot be changed this way: ${String(error)}`)),
  )
  const shown: RobotSettings = yield* ask(robot, 'settings')
  const model = patch.model === undefined && patch.thinking === undefined ? undefined : {
    provider: patch.model?.provider ?? shown.model.provider, model: patch.model?.model ?? shown.model.model, effort: patch.thinking ?? shown.model.effort,
  }
  if (model !== undefined) {
    const refusal = yield* promise(() => modelRefusal(platform.env, current.ownerId, shown.model, model))
    if (refusal !== null) return yield* invalid(refusal)
  }
  const change: SettingsPatch = {
    ...(model === undefined ? {} : { model }),
    ...(patch.chain === undefined ? {} : { chain: patch.chain }),
    ...(patch.codeMode === undefined ? {} : { codeMode: patch.codeMode }),
    ...(patch.contextBudget === undefined ? {} : { contextBudget: patch.contextBudget }),
    ...(patch.compactionInstruction === undefined ? {} : { compactionInstruction: patch.compactionInstruction }),
    ...(patch.discordChannel === undefined ? {} : { discordChannel: patch.discordChannel }),
    ...(patch.discordProactive === undefined ? {} : { discordProactive: patch.discordProactive }),
    ...(patch.browserBackend === undefined ? {} : { browserBackend: patch.browserBackend }),
    ...(patch.wakeOnScreenNotifications === undefined ? {} : { wakeOnScreenNotifications: patch.wakeOnScreenNotifications }),
    ...(patch.cacheWarming === undefined ? {} : { cacheWarming: patch.cacheWarming }),
    ...(patch.idleCompaction === undefined ? {} : { idleCompaction: patch.idleCompaction }),
    ...(patch.idleCompactionFloorTokens === undefined ? {} : { idleCompactionFloorTokens: patch.idleCompactionFloorTokens }),
    ...(patch.autoReview === undefined ? {} : { autoReview: patch.autoReview }),
    ...(patch.reviewer === undefined ? {} : { reviewer: patch.reviewer }),
    ...(patch.notifications === undefined ? {} : { notifications: {
      enabled: patch.notifications.enabled ?? shown.notifications.enabled,
      members: shown.notifications.members,
      channels: patch.notifications.channels ?? shown.notifications.channels,
    } }),
  }
  return yield* ask(robot, 'updateSettings', change, by)
})

/** robot_configure: the whole identity (cd-28og). */
export const configure = (robotId: string, change: { name?: string; title?: string; description?: string; avatarColor?: string }) => Effect.gen(function* () {
  const { entry, robot, by } = yield* reach(robotId, true)
  const given = Object.fromEntries(Object.entries(change).filter(([, value]) => typeof value === 'string' && value.trim() !== ''))
  if (typeof given['avatarColor'] === 'string' && !/^#[0-9a-fA-F]{6}$/.test(given['avatarColor'])) return yield* invalid('avatarColor is #rrggbb')
  const settings = yield* ask(robot, 'updateSettings', { identity: { ...entry.identity, ...given } }, by)
  return { id: robotId, identity: settings.identity as unknown }
})


export type Run = <A>(program: Effect.Effect<A, { readonly _tag: string; readonly message: string }, RobotState | RobotPlatform>) => Promise<A>

/** Results that crossed Workers RPC carry stubs' bookkeeping; the model's tools get plain JSON. */
export const plain = async <A>(result: Promise<A>): Promise<A> => JSON.parse(JSON.stringify(await result)) as A

/** The host the deputy tools call, each method one of the programs above run in the Robot Durable Object. */
export function deputyHost(run: Run): DeputyHost {
  return {
    list: () => plain(run(list)),
    conversation: (id, page) => plain(run(conversation(id, page))),
    searchConversation: (id, query, page) => plain(run(searchConversation(id, query, page))),
    trajectory: (id, item, before, after) => plain(run(trajectory(id, item, before, after))),
    files: (id) => plain(run(files(id))),
    fileRead: (id, path) => plain(run(fileRead(id, path))),
    grants: (id) => plain(run(grants(id))),
    settings: (id) => plain(run(settings(id))),
    fileWrite: (id, path, content) => plain(run(fileWrite(id, path, content))),
    fileDelete: (id, path) => plain(run(fileDelete(id, path))),
    settingsSet: (id, patch) => plain(run(settingsSet(id, patch))),
    helpRequests: () => plain(run(helpRequests)),
    helpAnswer: (id, request, text) => plain(run(helpAnswer(id, request, text))),
  }
}