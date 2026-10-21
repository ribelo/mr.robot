/**
 * The HTTP API of the edge Worker. It holds no state: every call is routed to the
 * Durable Object that owns the data, after resolving the caller to a Member.
 */
import { MEMBER_FILE_NAMES, type MemberFileName } from '../member/member.ts'
import { probe } from '../browser/probe.ts'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import {
  AlwaysAllowAnswer,
  DraftEdit,
  PageRename,
  PageShareInput,
  LoginInput,
  ConnectionPaste,
  CredentialSave,
  ConnectionPatch,
  PluginSettingsInput,
  PluginSwitch,
  BrowserBackend,
  MemberPreferences,
  AccountPatch,
  ApiKeyInput,
  SpaceSettingsPatch,
  OAuthFinish,
  GroupInput,
  GroupOrder,
  GroupPatch,
  HelpAnswer,
  ListPrefPatch,
  ProposalAnswer,
  PushSubscriptionInput,
  ShareInput,
  SkillRepositoryInput,
  RewindRequest,
  SendMessage,
  SettingsPatch,
  DEFAULT_MISSION_PREFS,
  TaskAssign,
  FileRestore,
  SaveDefinition,
  TaskInput,
  TaskPatch,
  TaskPause,
  TaskState,
  type Attachment,
  type MissionView,
  type TaskAssignee,
  type TaskPage,
  type TaskView,
  type ConnectorKind,
  type Me,
  type MemberAvatar,
  type MemberView,
  type RobotPanel,
  type SessionCapture,
} from '@mr-robot/protocol'
import { SPACE_ID, type Env } from '../env.ts'
import type { DefinitionRow } from '../definitions/library.ts'
import { definitionArchive } from '../definitions/tarball.ts'
import type { DefinitionView } from '@mr-robot/protocol'
import { memberAvatarObject } from '../space/space.ts'
import { makeWorkspace, normalizePath } from '../workspace/workspace.ts'
import { API_KEY_PROVIDERS, OAUTH_PROVIDERS, PROVIDER_IDS, type ProviderId } from '../agent/providers.ts'
import { modelRefusal } from '../robot/model-choice.ts'
import type { AnswerResult, HelpAnswerResult, PagePdf, SessionCaptureStart } from '../robot/robot.ts'
import { parseTimeZone } from '../robot/time-zone.ts'
import { parseJobId } from '../places/job-id.ts'
import { ApiError, badRequest, call, conflict, decodeBody, forbidden, notFound, Router } from './http.ts'
import { actsAsPerson, pluginByName } from '../plugins/catalog.ts'
import { connectPastedValues, sharingRefusal } from '../member/connect-pasted.ts'
import { isSignInKind } from '@mr-robot/host-protocol'
import type { TaskCaller, TaskFilter } from '../space/tasks.ts'

export interface ApiContext {
  readonly request: Request
  readonly env: Env
  readonly ctx: ExecutionContext
  readonly member: MemberView
}

const space = (env: Env) => env.SPACE.getByName(SPACE_ID)
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** The caller may use this Robot (owner, or shared with the Space); returns how. */
function reach(c: ApiContext, robotId: string): Effect.Effect<'owner' | 'shared', ApiError> {
  return call(() => space(c.env).access(c.member.id, robotId)).pipe(
    Effect.flatMap((access) => access === null ? Effect.fail(notFound('no such robot')) : Effect.succeed(access)),
  )
}

function owner(c: ApiContext, robotId: string): Effect.Effect<void, ApiError> {
  return reach(c, robotId).pipe(Effect.flatMap((access) => access === 'owner' ? Effect.void : Effect.fail(forbidden('only the owner can do that'))))
}

/** A connection as the person's connection list shows it (what the app decodes after a change). */
function connectionView(c: ApiContext, id: string) {
  return call(() => space(c.env).connectionsFor(c.member.id)).pipe(
    Effect.flatMap((views) => {
      const view = views.find((entry) => entry.id === id)
      return view === undefined ? Effect.fail(notFound('no such connection of yours')) : Effect.succeed(view)
    }),
  )
}

/** A connection that acts as a person (Slack, Google) is never shared with the Space (ux-bk91). */
function shareable(kind: ConnectorKind, shared: boolean): Effect.Effect<void, ApiError> {
  const refusal = sharingRefusal(kind, shared)
  return refusal === undefined ? Effect.void : Effect.fail(badRequest(refusal))
}

/** The caller's Mr. Robot, whose browser signs in to services for them (v1.12 ticket 11). */
function chief(c: ApiContext): Effect.Effect<string, ApiError> {
  return call(() => space(c.env).mrRobotOf(c.member.id)).pipe(Effect.flatMap((id) => id === null ? Effect.fail(notFound('you have no Mr. Robot')) : Effect.succeed(id)))
}

/** A connector kind connected by signing in to the service (Slack, Discord as you). */
function signInKind(kind: string) {
  return isSignInKind(kind) ? Effect.succeed(kind) : Effect.fail(notFound('this connector does not connect by signing in'))
}

function admin(c: ApiContext): Effect.Effect<void, ApiError> {
  return c.member.role === 'admin' ? Effect.void : Effect.fail(forbidden('admin only'))
}

/** The request header with the app's time zone (browser zone in the PWA, system zone in the desktop app). */
const TIME_ZONE_HEADER = 'X-Time-Zone'

const robot = (c: ApiContext, id: string) => c.env.ROBOT.getByName(id)

/** A definition row as a Member sees it. */
function definitionView(row: DefinitionRow, memberId: string): DefinitionView {
  return { slug: row.slug, title: row.title, paragraph: row.paragraph, source: row.source, author: row.author, published: row.published, mine: row.ownerId === memberId, updatedAt: row.updatedAt }
}

/** The ?chapter= of a request (v1.19): undefined when absent, null when it is not a chapter number. */
function chapterParam(request: Request): number | undefined | null {
  const value = new URL(request.url).searchParams.get('chapter')
  if (value === null) return undefined
  return /^\d+$/.test(value) ? Number(value) : null
}

/**
 * The caller of a Task route: the Member, recorded as themselves. The Space admin sees every Task with Whole Space
 * (mc-m7gg): a list asks for it with scope=home; one Task's routes follow the admin's remembered switch.
 */
/** One Task's routes reach every Task of the Space only while the admin has Whole Space on (mc-m7gg). */
function taskCallerByPrefs(c: ApiContext): Effect.Effect<Extract<TaskCaller, { kind: 'member' }>, ApiError> {
  if (c.member.role !== 'admin') return Effect.succeed(taskCaller(c, false))
  return Effect.map(call(() => c.env.MEMBER.getByName(c.member.id).profile()), (profile) => taskCaller(c, profile.mission?.wholeSpace === true))
}

function taskCaller(c: ApiContext, wholeSpace: boolean): Extract<TaskCaller, { kind: 'member' }> {
  return { kind: 'member', memberId: c.member.id, wholeSpace: wholeSpace && c.member.role === 'admin', actor: { kind: 'member', memberId: c.member.id, name: c.member.name } }
}

const isTaskState = Schema.is(TaskState)

/** "member:<id>", "robot:<id>" or "nobody", as a list filter names an assignee. */
function assigneeParam(value: string | null): TaskAssignee | undefined {
  if (value === null) return undefined
  if (value === 'nobody') return { kind: 'nobody' }
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  if (id === '') return undefined
  return kind === 'member' ? { kind: 'member', memberId: id } : kind === 'robot' ? { kind: 'robot', robotId: id } : undefined
}

/** The Tasks list's query: state (open by default, or all), words in the title, parent, assignee, grouping and page. */
export function taskFilter(query: URLSearchParams): TaskFilter {
  const state = query.get('state')
  const group = query.get('group')
  const assignee = assigneeParam(query.get('assignee'))
  const page = Number(query.get('page') ?? query.get('taskPage') ?? '1')
  const q = query.get('q')
  const parent = query.get('parent')
  return {
    ...(state === 'all' || (state !== null && isTaskState(state)) ? { state } : {}),
    ...(q === null ? {} : { q }),
    ...(parent === null ? {} : { parentId: parent }),
    ...(assignee === undefined ? {} : { assignee }),
    ...(group === 'assignee' || group === 'parent' || group === 'time' ? { group } : {}),
    ...(Number.isInteger(page) && page >= 1 ? { page } : {}),
  }
}

export const api = new Router<ApiContext>()
  // ------------------------------------------------------------ me
  .on('GET', '/api/me', (c) => call(async (): Promise<Me> => {
    const member = c.env.MEMBER.getByName(c.member.id)
    // Channels link into the app by the address it is opened at (v1.15).
    await space(c.env).rememberOrigin(new URL(c.request.url).origin)
    // The app tells its zone each time it opens; anything that is not a zone is ignored.
    const reported = parseTimeZone(c.request.headers.get(TIME_ZONE_HEADER) ?? '')
    const profile = await (reported === undefined ? member.profile() : member.detectTimeZone(reported))
    return { ...c.member, ...(profile.nickname === undefined ? {} : { nickname: profile.nickname }), home: c.env.SPACE_NAME, timeZone: profile.timeZone, timeZonePinned: profile.timeZonePinned === true, detectedTimeZone: profile.detectedTimeZone ?? null, quietHours: profile.quietHours, vapidPublicKey: c.env.VAPID_PUBLIC_KEY, workDetails: profile.workDetails ?? 'compact', theme: profile.theme ?? 'system', mission: { ...DEFAULT_MISSION_PREFS, ...profile.mission }, acceptTasksFrom: [...(profile.acceptTasksFrom ?? [])] }
  }))
  // Every Page the Member shares (v1.17, dp-zq16).
  .on('GET', '/api/me/shared-pages', (c) => call(() => c.env.MEMBER.getByName(c.member.id).sharedPages(new URL(c.request.url).origin)))
  // The Member's own month by source across their Robots (ao-ef5t).
  .on('GET', '/api/me/costs', (c) => call(() => space(c.env).memberCosts(c.member.id)))
  .on('PATCH', '/api/me', (c) => Effect.gen(function* () {
    const { avatarColor, acceptTasksFrom, ...rest } = yield* decodeBody(c.request, MemberPreferences)
    // Only other active Members of the Space can be named (mc-a1aa).
    const others = acceptTasksFrom === undefined ? undefined : new Set((yield* call(() => space(c.env).members())).filter((member) => member.status === 'active' && member.id !== c.member.id).map((member) => member.id))
    const patch = { ...rest, ...(acceptTasksFrom === undefined || others === undefined ? {} : { acceptTasksFrom: [...new Set(acceptTasksFrom)].filter((id) => others.has(id)) }) }
    yield* call(() => c.env.MEMBER.getByName(c.member.id).updateProfile(patch))
    if (patch.name !== undefined) yield* call(() => space(c.env).rename(c.member.id, patch.name!))
    if (avatarColor !== undefined) yield* call((): Promise<MemberAvatar> => space(c.env).setAvatarColor(c.member.id, avatarColor))
    return { ok: true }
  }))
  // The avatar picture (ux-s88l): the app resizes it to 256 px; the server keeps at most 1 MB of PNG, JPEG or WebP.
  .on('PUT', '/api/me/avatar', (c) => Effect.gen(function* () {
    const picture = yield* avatarPicture(c.request)
    const key = `avatar-${yield* Effect.promise(() => pictureHash(picture.bytes))}`
    yield* call(() => c.env.FILES.put(memberAvatarObject(c.member.id, key), picture.bytes, { httpMetadata: { contentType: picture.contentType } }))
    return yield* call((): Promise<MemberAvatar> => space(c.env).setAvatarPicture(c.member.id, key))
  }))
  .on('DELETE', '/api/me/avatar', (c) => call((): Promise<MemberAvatar> => space(c.env).removeAvatarPicture(c.member.id)))
  // Any Member of the Space sees another Member's picture (ux-2ft4); the key changes with the picture.
  .on('GET', '/api/members/:member/avatar/:key', (c, { member, key }) => Effect.gen(function* () {
    if (!AVATAR_KEY.test(key)) return yield* Effect.fail(notFound('no such picture'))
    const object = yield* call(() => c.env.FILES.get(memberAvatarObject(member, key)))
    if (object === null) return yield* Effect.fail(notFound('no such picture'))
    return new Response(object.body, {
      headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
    })
  }))
  .on('GET', '/api/me/files/:name', (c, { name }) => fileName(name).pipe(
    Effect.flatMap((file) => call(() => c.env.MEMBER.getByName(c.member.id).file(file)).pipe(Effect.map((content) => ({ name: file, content })))),
  ))
  .on('PUT', '/api/me/files/:name', (c, { name }) => Effect.gen(function* () {
    const file = yield* fileName(name)
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).writeFile(file, content))
    return { ok: true }
  }))

  .on('GET', '/api/me/files/:name/history', (c, { name }) => fileName(name).pipe(Effect.flatMap((file) => call(() => c.env.MEMBER.getByName(c.member.id).memberFileHistory(file)))))
  .on('GET', '/api/me/files/:name/versions/:version', (c, { name, version }) => Effect.gen(function* () {
    const file = yield* fileName(name)
    const found = yield* call(() => c.env.MEMBER.getByName(c.member.id).memberFileVersion(file, version))
    return found ?? (yield* Effect.fail(notFound('no such version')))
  }))
  .on('POST', '/api/me/files/:name/restore', (c, { name }) => Effect.gen(function* () {
    const file = yield* fileName(name)
    const { version } = yield* decodeBody(c.request, FileRestore)
    if (!(yield* call(() => c.env.MEMBER.getByName(c.member.id).restoreMemberFile(file, version)))) return yield* Effect.fail(notFound('no such version'))
    return { ok: true }
  }))

  // ------------------------------------------------------------ Web Push devices (robot-ajrp, robot-9xoj)
  .on('POST', '/api/push/subscriptions', (c) => Effect.gen(function* () {
    const input = yield* decodeBody(c.request, PushSubscriptionInput)
    if (!input.endpoint.startsWith('https://')) return yield* Effect.fail(badRequest('a push endpoint is an https URL'))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).addPushDevice({ endpoint: input.endpoint, keys: input.keys, ...(input.device === undefined ? {} : { device: input.device }) }))
    return { ok: true }
  }))
  .on('DELETE', '/api/push/subscriptions', (c) => Effect.gen(function* () {
    const { endpoint } = yield* decodeBody(c.request, Schema.Struct({ endpoint: Schema.String }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).removePushDevice(endpoint))
    return { ok: true }
  }))

  // ------------------------------------------------------------ secrets (robot-vplt)
  .on('GET', '/api/secrets', (c) => call(() => space(c.env).secretsView(c.member.id)))
  .on('PUT', '/api/secrets/:name', (c, { name }) => Effect.gen(function* () {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return yield* Effect.fail(badRequest('login names use letters, digits, ".", "_" and "-"'))
    const { shared, ...patch } = yield* decodeBody(c.request, LoginInput)
    yield* call(() => space(c.env).putLogin(c.member.id, name, { ...patch, ...(patch.websites === undefined ? {} : { websites: patch.websites.map((site) => site.trim()).filter((site) => site !== '') }) }, shared)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('GET', '/api/secrets/:name/reveal', (c, { name }) => Effect.map(call(() => space(c.env).revealLogin(c.member.id, name)), (password) => ({ password })))
  .on('DELETE', '/api/secrets/:name', (c, { name }) => call(() => space(c.env).deleteSecret(c.member.id, name)))

  // ------------------------------------------------------------ skill library (robot-7qpi, robot-qjvu)
  .on('GET', '/api/skills', (c) => call(async () => ({ skills: await space(c.env).skills(c.member.id), repository: await space(c.env).skillRepository() })))
  .on('PUT', '/api/admin/skills/repository', (c) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, SkillRepositoryInput)
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo)) return yield* Effect.fail(badRequest('the repository is owner/name on GitHub'))
    yield* call(() => space(c.env).setSkillRepository({ repo: input.repo, ref: input.ref || 'main', path: input.path }, input.token))
    return { ok: true }
  }))
  .on('POST', '/api/admin/browser-probe', (c) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, Schema.Struct({ backend: BrowserBackend, url: Schema.String, waitMs: Schema.optional(Schema.Number) }))
    return yield* call(() => probe(c.env, input.backend, input.url, input.waitMs))
  }))
  // ------------------------------------------------------------ Hosts (v1.2)
  .on('GET', '/api/hosts', (c) => call(() => space(c.env).hostsFor(c.member.id)))
  // ---------------------------------------------------------------- plugins and connections (v1.5)
  .on('GET', '/api/plugins', (c) => call(() => space(c.env).plugins(c.member.id, new URL(c.request.url).origin)))
  .on('PUT', '/api/admin/plugins/:name', (c, { name }) => Effect.gen(function* () {
    yield* admin(c)
    const body = yield* decodeBody(c.request, PluginSwitch)
    if (pluginByName(name) === undefined) return yield* Effect.fail(notFound('no such plugin'))
    yield* call(() => space(c.env).setPluginEnabled(name, body.enabled))
    return { ok: true }
  }))
  .on('PUT', '/api/admin/plugins/:name/settings', (c, { name }) => Effect.gen(function* () {
    yield* admin(c)
    const body = yield* decodeBody(c.request, PluginSettingsInput)
    if (pluginByName(name) === undefined) return yield* Effect.fail(notFound('no such plugin'))
    return yield* Effect.tryPromise({ try: () => space(c.env).setPluginConfig(name, body.values, new URL(c.request.url).origin), catch: (error) => badRequest(error instanceof Error ? error.message.replace(/^PluginConfigInvalid: /, '') : 'the settings are not valid') })
  }))
  .on('GET', '/api/connections', (c) => call(() => space(c.env).connectionsFor(c.member.id)))
  .on('GET', '/api/connections/notes', (c) => call(() => space(c.env).connectionNotes(c.member.id)))
  .on('DELETE', '/api/connections/notes/:id', (c, { id }) => Effect.gen(function* () {
    const dismissed = yield* call(() => space(c.env).dismissConnectionNote(c.member.id, id))
    return dismissed ? { ok: true } : yield* Effect.fail(notFound('no such note'))
  }))
  // Google consent (v1.5 ticket 02): the browser navigates here, so both answer with a redirect.
  .on('GET', '/api/connections/google/oauth/start', (c) => Effect.promise(async () => {
    const url = new URL(c.request.url)
    const services = (url.searchParams.get('services') ?? '').split(',').filter(Boolean)
    // A Google account acts as the person, so it is never shared with the Space (ux-bk91).
    if (url.searchParams.get('shared') === '1' && actsAsPerson('google')) return Response.redirect(`${url.origin}/#/me?connection-error=${encodeURIComponent('a Google connection acts as you, so it cannot be shared with the Space')}`, 302)
    try {
      const consent = await c.env.MEMBER.getByName(c.member.id).startGoogleConsent(url.origin, services, url.searchParams.get('shared') === '1', url.searchParams.get('reconnect'), url.searchParams.get('external') === '1')
      return Response.redirect(consent, 302)
    } catch (error) {
      return Response.redirect(`${url.origin}/#/me?connection-error=${encodeURIComponent(error instanceof Error ? error.message : 'could not start the sign-in')}`, 302)
    }
  }))
  .on('POST', '/api/connections/:kind', (c, { kind }) => Effect.gen(function* () {
    const body = yield* decodeBody(c.request, ConnectionPaste)
    const added = yield* connectPastedValues(c.env, c.member.id, kind, body).pipe(Effect.mapError((refused) => refused.status === 404 ? notFound(refused.message) : badRequest(refused.message)))
    return yield* connectionView(c, added.id)
  }))
  // Connect as you through Mr. Robot's browser (v1.12 ticket 11, ux-8pek): the sign-in page opens there
  // under a Takeover; on hand-back the platform reads the session and connects it as a paste would.
  .on('POST', '/api/connections/:kind/browser-start', (c, { kind }) => Effect.gen(function* () {
    const service = yield* signInKind(kind)
    const robotId = yield* chief(c)
    const started = yield* call((): Promise<SessionCaptureStart> => robot(c, robotId).startSessionCapture(service))
    return started.ok ? { robotId, robotName: started.robotName } : yield* Effect.fail(conflict(started.message))
  }))
  .on('GET', '/api/connections/:kind/browser', (c, { kind }) => Effect.gen(function* () {
    const service = yield* signInKind(kind)
    const robotId = yield* chief(c)
    return yield* call((): Promise<SessionCapture> => robot(c, robotId).sessionCapture(service))
  }))
  // The page's Takeover closed: the attempt ends now (a hand-back already ending it is waited for).
  .on('POST', '/api/connections/:kind/browser-end', (c, { kind }) => Effect.gen(function* () {
    const service = yield* signInKind(kind)
    const robotId = yield* chief(c)
    return yield* call((): Promise<SessionCapture> => robot(c, robotId).endSessionCapture(service))
  }))
  .on('PATCH', '/api/connections/:id', (c, { id }) => Effect.gen(function* () {
    const body = yield* decodeBody(c.request, ConnectionPatch)
    const current = yield* call(() => c.env.MEMBER.getByName(c.member.id).connection(id))
    if (current === undefined) return yield* Effect.fail(notFound('no such connection of yours'))
    yield* shareable(current.kind, body.shared === true)
    const updated = yield* call(() => c.env.MEMBER.getByName(c.member.id).updateConnection(id, {
      ...(body.label === undefined || body.label.trim() === '' ? {} : { label: body.label.trim() }),
      ...(body.shared === undefined ? {} : { shared: body.shared }),
      ...(body.isDefault === true ? { isDefault: true } : {}),
      ...(body.instructions === undefined ? {} : { instructions: body.instructions }),
    }))
    return updated === undefined ? yield* Effect.fail(notFound('no such connection of yours')) : yield* connectionView(c, updated.id)
  }))
  .on('DELETE', '/api/connections/:id', (c, { id }) => Effect.gen(function* () {
    const removed = yield* call(() => c.env.MEMBER.getByName(c.member.id).removeConnection(id))
    return removed ? { ok: true } : yield* Effect.fail(notFound('no such connection of yours'))
  }))
  .on('GET', '/api/hosts/pair/:code', (c, { code }) => call(() => space(c.env).pairingView(code)))
  .on('POST', '/api/hosts/pair/:code', (c, { code }) => call(() => space(c.env).approvePairing(code, c.member.id)))
  .on('PATCH', '/api/hosts/:id', (c, { id }) => Effect.gen(function* () {
    const { sharing } = yield* decodeBody(c.request, Schema.Struct({ sharing: Schema.Literals(['private', 'home']) }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setHostSharing(id, sharing))
    return { ok: true }
  }))
  .on('DELETE', '/api/hosts/:id', (c, { id }) => Effect.gen(function* () {
    const owner = yield* call(() => space(c.env).hostOwner(id))
    if (owner !== c.member.id && c.member.role !== 'admin') return yield* Effect.fail(forbidden('only the person who paired this host can unpair it'))
    yield* call(() => c.env.MEMBER.getByName(owner ?? c.member.id).unpairHost(id))
    return { ok: true }
  }))
  .on('GET', '/api/space-memory', (c) => call(async () => ({ content: await space(c.env).spaceMemory() })))
  .on('GET', '/api/admin/space-memory/history', (c) => admin(c).pipe(Effect.andThen(call(() => space(c.env).spaceMemoryHistory()))))
  .on('GET', '/api/admin/space-memory/versions/:version', (c, { version }) => Effect.gen(function* () {
    yield* admin(c)
    const found = yield* call(() => space(c.env).spaceMemoryVersion(version))
    return found ?? (yield* Effect.fail(notFound('no such version')))
  }))
  .on('POST', '/api/admin/space-memory/restore', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { version } = yield* decodeBody(c.request, FileRestore)
    if (!(yield* call(() => space(c.env).restoreSpaceMemory(version, c.member.name)))) return yield* Effect.fail(notFound('no such version'))
    return { ok: true }
  }))
  .on('PUT', '/api/admin/space-memory', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    yield* call(() => space(c.env).setSpaceMemory(content, 'the Space admin', null))
    return { ok: true }
  }))
  // The host action log (pl-vcy7): only the host's owner sees it.
  .on('GET', '/api/hosts/:id/actions', (c, { id }) => call(async () => {
    const member = c.env.MEMBER.getByName(c.member.id)
    if (!(await member.hostList()).some((host) => host.id === id)) throw Object.assign(new Error('no such computer of yours'), { status: 404 })
    return member.hostActions(id)
  }))
  .on('PUT', '/api/admin/exa', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { key } = yield* decodeBody(c.request, Schema.Struct({ key: Schema.NullOr(Schema.String) }))
    yield* call(() => space(c.env).setExaKey(key))
    return { ok: true, configured: key !== null && key.trim() !== '' }
  }))
  .on('POST', '/api/admin/models/refresh', (c) => admin(c).pipe(Effect.andThen(call(() => space(c.env).refreshCatalogs(c.member.id)))))
  .on('GET', '/api/skills/:name', (c, { name }) => Effect.gen(function* () {
    const content = yield* call(() => space(c.env).skillContent(c.member.id, name))
    if (content === null) return yield* Effect.fail(notFound(`no skill "${name}"`))
    return { name, content }
  }))
  .on('PUT', '/api/admin/skills/:name', (c, { name }) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, Schema.Struct({ description: Schema.String, content: Schema.String }))
    yield* call(() => space(c.env).saveSkill(name, input.description, input.content, c.member.id)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('DELETE', '/api/admin/skills/:name', (c, { name }) => admin(c).pipe(Effect.andThen(call(() => space(c.env).deleteSkill(name))), Effect.as({ ok: true })))
  // Robot definitions (v1.18 ticket 04): Save as definition, the library's list, and the directory to commit by hand.
  .on('POST', '/api/robots/:id/definition', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const { slug } = yield* decodeBody(c.request, SaveDefinition)
    const row = yield* call(() => robot(c, id).saveAsDefinition(slug))
    return definitionView(row, c.member.id)
  }))
  // Add a definition: a new Robot of the Member in setup, from the definition's files (v1.18 ticket 05).
  // The Marketplace (v1.18 ticket 06): every definition a Member sees with its needs matched; the admin publishes and removes.
  .on('GET', '/api/marketplace', (c) => call(() => space(c.env).marketplace(c.member.id)).pipe(Effect.map((entries) => entries.map((entry) => ({ definition: definitionView(entry.row, c.member.id), tools: entry.tools, needs: entry.needs })))))
  .on('POST', '/api/admin/definitions/:slug/publish', (c, { slug }) => Effect.gen(function* () {
    yield* admin(c)
    const { published } = yield* decodeBody(c.request, Schema.Struct({ published: Schema.Boolean }))
    yield* call(() => space(c.env).setDefinitionPublished(slug, published))
    return { ok: true }
  }))
  .on('DELETE', '/api/admin/definitions/:slug', (c, { slug }) => admin(c).pipe(Effect.andThen(call(() => space(c.env).removeDefinition(slug))), Effect.as({ ok: true })))
  // Add from a Grok Bot marketplace address (v1.18 ticket 07): a brief, the Member's own until the admin publishes it.
  .on('POST', '/api/definitions/import', (c) => Effect.gen(function* () {
    const { url } = yield* decodeBody(c.request, Schema.Struct({ url: Schema.String }))
    return definitionView(yield* call(() => space(c.env).importGrokTemplate(c.member.id, url)), c.member.id)
  }))
  .on('POST', '/api/definitions/:slug/add', (c, { slug }) => call(() => space(c.env).addDefinition(c.member.id, slug)))
  .on('GET', '/api/definitions', (c) => call(() => space(c.env).definitions(c.member.id)).pipe(Effect.map((rows) => rows.map((row) => definitionView(row, c.member.id)))))
  .on('GET', '/api/definitions/:slug/archive', (c, { slug }) => Effect.gen(function* () {
    const files = yield* call(() => space(c.env).definitionFiles(slug, c.member.id))
    if (files === null) return yield* Effect.fail(notFound('no such definition'))
    const archive = yield* Effect.promise(() => definitionArchive(`robots/${slug}`, new Map(files.map((file) => [file.path, file.body])), Date.now()))
    return new Response(archive, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${slug}.tar.gz"` } })
  }))
  .on('POST', '/api/admin/skills/sync', (c) => admin(c).pipe(Effect.andThen(call(() => space(c.env).syncSkills()).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message))))))

  // ------------------------------------------------------------ Providers (robot-dic7, robot-lzu3, robot-7v9s)
  .on('GET', '/api/providers', (c) => call(() => space(c.env).providersView(c.member.id)))
  // Provider accounts (v1.10 ticket 02): many per Provider, each shared on its own (pa-i3le, pa-f281).
  .on('POST', '/api/providers/:provider/accounts', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, [...API_KEY_PROVIDERS, 'opencode-go'])
    const input = yield* decodeBody(c.request, ApiKeyInput)
    const id = yield* call(() => c.env.MEMBER.getByName(c.member.id).addApiKey(name, input.key, input.shared, input.label)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { id }
  }))
  .on('POST', '/api/providers/:provider/oauth/start', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, OAUTH_PROVIDERS)
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).startOAuth(name as 'openai' | 'anthropic'))
  }))
  .on('POST', '/api/providers/:provider/oauth/finish', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, OAUTH_PROVIDERS)
    const input = yield* decodeBody(c.request, OAuthFinish)
    const connected = yield* call(() => c.env.MEMBER.getByName(c.member.id).finishOAuth(name as 'openai' | 'anthropic', input.pasted, input.shared)).pipe(
      Effect.mapError((error) => badRequest(error.detail ?? error.message)),
    )
    return { connected }
  }))
  .on('PATCH', '/api/accounts/:id', (c, { id }) => Effect.gen(function* () {
    const change = yield* decodeBody(c.request, AccountPatch)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).updateAccount(id, { ...(change.label === undefined ? {} : { label: change.label }), ...(change.shared === undefined ? {} : { shared: change.shared }) }))
    return { ok: true }
  }))
  .on('DELETE', '/api/accounts/:id', (c, { id }) => call(() => c.env.MEMBER.getByName(c.member.id).removeAccount(id)).pipe(Effect.as({ ok: true })))
  // Usage windows (pa-lmbl, pa-sps4); another Member's account only when it is shared with the Space (pa-sstr).
  .on('GET', '/api/accounts/:id/usage', (c, { id }) => Effect.gen(function* () {
    const owner = new URL(c.request.url).searchParams.get('owner') ?? c.member.id
    if (owner === c.member.id) return yield* call(() => c.env.MEMBER.getByName(owner).accountUsage(id, false))
    const { shared } = yield* call(() => space(c.env).accountsFor(c.member.id))
    if (!shared.some((account) => account.id === id && account.ownerId === owner)) return yield* Effect.fail(notFound('no such shared account'))
    return yield* call(() => c.env.MEMBER.getByName(owner).accountUsage(id, true))
  }))
  .on('POST', '/api/accounts/:id/check', (c, { id }) => call(() => c.env.MEMBER.getByName(c.member.id).checkAccount(id)))
  .on('GET', '/api/admin/settings', (c) => admin(c).pipe(Effect.andThen(call(async () => ({ ...(await space(c.env).settings()), models: await space(c.env).offeredModelList() })))))
  // Switching Workers AI off may move the default model; the answer says so for the admin's note (ux-jseo).
  .on('PATCH', '/api/admin/settings', (c) => Effect.gen(function* () {
    yield* admin(c)
    const patch = yield* decodeBody(c.request, SpaceSettingsPatch)
    const saved = yield* call(() => space(c.env).updateSettings(patch, c.member.id))
    return { ...saved, models: yield* call(() => space(c.env).offeredModelList()) }
  }))

  // ------------------------------------------------------------ robots
  .on('GET', '/api/robots', (c) => call(async () => {
    const robots = await space(c.env).reachable(c.member.id)
    // Read with what this person reaches now: a Robot that left their reach leaves its group (ux-lywk).
    const prefs = await c.env.MEMBER.getByName(c.member.id).listPrefs(robots.map((summary) => summary.id))
    return robots.map((summary) => {
      const pref = prefs[summary.id]
      // Unread: newer than when this person last opened it, or marked unread by them (robot-mktj).
      const unread = pref?.markedUnread === true || (pref?.seenAt != null && summary.lastAt > pref.seenAt)
      return { ...summary, unread, pinned: pref?.pinned === true, hidden: pref?.hidden === true, ...(pref?.groupId === undefined ? {} : { groupId: pref.groupId }) }
    })
  }))
  .on('POST', '/api/robots/:id/list', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const change = yield* decodeBody(c.request, ListPrefPatch)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setListPref(id, change))
    return { ok: true }
  }))
  // The person's own sidebar groups (ux-wxbm, ux-o7po, ux-xbvi, ux-oltg): nobody else sees or changes them.
  .on('GET', '/api/robot-groups', (c) => call(() => c.env.MEMBER.getByName(c.member.id).groups()))
  .on('POST', '/api/robot-groups', (c) => Effect.gen(function* () {
    const { name } = yield* decodeBody(c.request, GroupInput)
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).createGroup(name))
  }))
  .on('PUT', '/api/robot-groups/order', (c) => Effect.gen(function* () {
    const { ids } = yield* decodeBody(c.request, GroupOrder)
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).orderGroups(ids))
  }))
  .on('PATCH', '/api/robot-groups/:id', (c, { id }) => Effect.gen(function* () {
    const patch = yield* decodeBody(c.request, GroupPatch)
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).updateGroup(id, patch))
  }))
  .on('DELETE', '/api/robot-groups/:id', (c, { id }) => call(() => c.env.MEMBER.getByName(c.member.id).removeGroup(id)).pipe(Effect.as({ ok: true })))
  .on('POST', '/api/robots', (c) => Effect.gen(function* () {
    const { brief, model } = yield* decodeBody(c.request, Schema.Struct({
      brief: Schema.optional(Schema.String),
      model: Schema.optional(Schema.Struct({ provider: Schema.String, model: Schema.String, effort: Schema.String })),
    }))
    return yield* call(() => space(c.env).createRobot(c.member.id, brief, model as import('@mr-robot/protocol').ModelChoice | undefined)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
  }))
  .on('GET', '/api/robots/:id/conversation', (c, { id }) => reach(c, id).pipe(
    Effect.andThen(() => {
      // A page at a time (v1.19, ec-n0uh): the newest, or the one older than the cursor a page gave.
      const query = new URL(c.request.url).searchParams
      return call(() => robot(c, id).chatPage(query.get('before'), query.get('details') === '1'))
    }),
    Effect.tap(() => call(() => c.env.MEMBER.getByName(c.member.id).markSeen(id, Date.now()))),
  ))
  .on('GET', '/api/robots/:id/trajectory', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    // One chapter at a time (v1.19, ec-mwvo): ?chapter=<ordinal>, the live one without it.
    const chapter = chapterParam(c.request)
    if (chapter === null) return yield* Effect.fail(badRequest('chapter is a chapter number'))
    return yield* call(() => robot(c, id).trajectoryMasked(chapter))
  }))
  .on('POST', '/api/robots/:id/rewind', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const input = yield* decodeBody(c.request, RewindRequest)
    if (input.beforeTurn === undefined && input.atSeq === undefined) return yield* Effect.fail(badRequest('give atSeq or beforeTurn'))
    // Into any chapter of the Conversation (v1.19, ec-i74p); there is no undo: what came after stays readable, superseded.
    return yield* call(() => (input.beforeTurn !== undefined ? robot(c, id).rewindBeforeTurn(input.beforeTurn, input.chapter) : robot(c, id).rewind(input.atSeq!, input.chapter))).pipe(Effect.mapError((error) => conflict(error.detail ?? error.message)))
  }))
  .on('POST', '/api/robots/:id/messages', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const message = yield* decodeBody(c.request, SendMessage)
    if (message.text.trim() === '' && (message.attachments ?? []).length === 0) return yield* Effect.fail(badRequest('empty message'))
    const sender = { kind: 'member' as const, memberId: c.member.id, name: c.member.name }
    const wakeup = yield* call(() => robot(c, id).wake({ kind: 'member', sender, text: message.text, attachments: message.attachments ?? [], ...(message.clientId === undefined ? {} : { clientId: message.clientId }), ...(message.followup === true ? { followup: true } : {}) }))
    return { wakeup }
  }))
  .on('PUT', '/api/robots/:id/files', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const name = new URL(c.request.url).searchParams.get('name') ?? ''
    const safe = name.replace(/[\\/]/g, '_').replace(/^\.+/, '').slice(0, 200)
    if (safe === '' || c.request.body === null) return yield* Effect.fail(badRequest('a file name and body are required'))
    const size = Number(c.request.headers.get('content-length'))
    if (!Number.isSafeInteger(size) || size <= 0) return yield* Effect.fail(badRequest('send the file with its length'))
    if (size > MAX_ATTACHMENT_BYTES) return yield* Effect.fail(badRequest('files up to 50 MB'))
    const contentType = c.request.headers.get('content-type') ?? 'application/octet-stream'
    const path = `attachments/${new Date().toISOString().slice(0, 10)}/${Date.now().toString(36)}-${safe}`
    // The declared length is enforced while streaming: a body longer or shorter than it fails.
    const body = c.request.body.pipeThrough(new FixedLengthStream(size))
    const entry = yield* makeWorkspace(c.env.FILES, id).write(path, body, contentType).pipe(Effect.mapError((error) => badRequest(error.message)))
    const attachment: Attachment = { name: safe, path: entry.path, size: entry.size, contentType }
    return attachment
  }))
  .on('GET', '/api/robots/:id/screen', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const body = yield* call(() => robot(c, id).screenImage())
    if (body === undefined) return yield* Effect.fail(notFound('no screen yet'))
    return new Response(body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' } })
  }))
  // ------------------------------------------------------------ Files view (v1.1 ticket 08)
  .on('GET', '/api/robots/:id/files', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    return yield* call(() => robot(c, id).files())
  }))
  .on('GET', '/api/robots/:id/raw', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const url = new URL(c.request.url)
    const path = normalizePath(url.searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const file = yield* call(() => robot(c, id).fileRaw(path))
    if (file === undefined) return yield* Effect.fail(notFound(`no file "${path}"`))
    const name = path.split('/').pop() ?? 'file'
    const download = url.searchParams.get('download') === '1'
    return new Response(file.body, {
      headers: {
        'content-type': file.mediaType,
        'content-disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        // A robot-written file is never a script on our origin; PDFs and images need the viewer, the rest is sandboxed.
        ...(file.mediaType === 'application/pdf' || file.mediaType.startsWith('image/') && file.mediaType !== 'image/svg+xml' ? {} : { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }),
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    })
  }))
  .on('GET', '/api/robots/:id/file', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    return yield* call(() => robot(c, id).fileContent(path))
  }))
  .on('PUT', '/api/robots/:id/file', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    return yield* call(() => robot(c, id).saveFile(path, content))
  }))
  // File history (v1.18, rm-7jo4): who wrote a persona or memory file, its kept versions, and Restore (a new version).
  .on('GET', '/api/robots/:id/file/history', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    return yield* call(() => robot(c, id).fileHistory(path))
  }))
  .on('GET', '/api/robots/:id/file/version', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const query = new URL(c.request.url).searchParams
    const path = normalizePath(query.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    return yield* call(() => robot(c, id).fileVersion(path, query.get('version') ?? ''))
  }))
  .on('POST', '/api/robots/:id/file/restore', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const { version } = yield* decodeBody(c.request, FileRestore)
    return yield* call(() => robot(c, id).restoreFile(path, version))
  }))
  .on('DELETE', '/api/robots/:id/file', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    yield* call(() => robot(c, id).deleteFile(path))
    return { ok: true }
  }))
  // ------------------------------------------------------------ Pages (v1.17 ticket 05)
  .on('GET', '/api/robots/:id/pages', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).pages()))))
  .on('GET', '/api/robots/:id/page', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    return yield* call(() => robot(c, id).pageContent(path))
  }))
  .on('POST', '/api/robots/:id/page/rename', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const input = yield* decodeBody(c.request, PageRename)
    const path = normalizePath(input.path)
    if (path === undefined || input.title.trim() === '') return yield* Effect.fail(badRequest('a Page path and a title'))
    return yield* call(() => robot(c, id).renamePage(path, input.title, c.member.name))
  }))
  .on('GET', '/api/robots/:id/page/pdf', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const printed = yield* call((): Promise<PagePdf> => robot(c, id).pagePdf(path, new URL(c.request.url).origin))
    switch (printed.kind) {
      case 'pdf': return pdfResponse(printed.title, printed.pdf)
      case 'limited': return yield* Effect.fail(new ApiError({ status: 429, message: printed.message }))
      case 'unavailable': return yield* Effect.fail(new ApiError({ status: 503, message: 'PDF unavailable: this Robot reached its spend limit.' }))
    }
  }))
  // Shared Pages (v1.17 ticket 06): the owner alone shares and stops sharing; there is no Robot tool for it (dp-62di).
  .on('GET', '/api/robots/:id/page/share', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    return { shared: yield* call(() => c.env.MEMBER.getByName(c.member.id).sharedPage(id, path, new URL(c.request.url).origin)) }
  }))
  .on('POST', '/api/robots/:id/page/share', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const input = yield* decodeBody(c.request, PageShareInput)
    const path = normalizePath(input.path)
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const { page } = yield* call(() => robot(c, id).pageContent(path))
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).sharePage(id, path, page.title, new URL(c.request.url).origin))
  }))
  .on('DELETE', '/api/robots/:id/page/share', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const input = yield* decodeBody(c.request, PageShareInput)
    const path = normalizePath(input.path)
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    const stopped = yield* call(() => c.env.MEMBER.getByName(c.member.id).stopSharing(id, path))
    return stopped ? { ok: true } : yield* Effect.fail(notFound('this Page is not shared'))
  }))
  .on('GET', '/api/robots/:id/webhook', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).webhook()))))
  .on('POST', '/api/robots/:id/webhook/regenerate', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).regenerateWebhook()))))
  .on('GET', '/api/robots/:id/prompt', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).promptPreview()))))
  .on('POST', '/api/robots/:id/retry', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).retry())), Effect.map((retried) => ({ retried }))))
  .on('GET', '/api/robots/:id/events', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const query = new URL(c.request.url).searchParams
    const number = (name: string) => (query.get(name) === null ? undefined : Number(query.get(name)))
    const chapter = chapterParam(c.request)
    if (chapter === null) return yield* Effect.fail(badRequest('chapter is a chapter number'))
    const page = yield* call(() => robot(c, id).sessionEvents({
      ...(chapter === undefined ? {} : { chapter }),
      ...(number('before') === undefined ? {} : { before: number('before')! }),
      ...(number('after') === undefined ? {} : { after: number('after')! }),
      ...(number('limit') === undefined ? {} : { limit: number('limit')! }),
    }))
    return new Response(`{"sessionId":${JSON.stringify(page.sessionId)},"hasMore":${page.hasMore},"events":${page.events}}`, { headers: { 'content-type': 'application/json' } })
  }))
  .on('GET', '/api/robots/:id/attachments/:attachment', (c, { id, attachment }) => Effect.gen(function* () {
    yield* reach(c, id)
    const image = yield* call(() => robot(c, id).screenshotImage(decodeURIComponent(attachment)))
    if (image === undefined) return yield* Effect.fail(notFound('no such image'))
    return new Response(image.body, { headers: { 'content-type': image.mediaType, 'cache-control': 'private, max-age=86400' } })
  }))
  .on('GET', '/api/robots/:id/panel', (c, { id }) => Effect.gen(function* () {
    const access = yield* reach(c, id)
    const entry = (yield* call(() => space(c.env).reachable(c.member.id))).find((summary) => summary.id === id)
    if (entry === undefined) return yield* Effect.fail(notFound())
    const tasks = (yield* call((): Promise<TaskPage> => space(c.env).listTasks(taskCaller(c, false), { assignee: { kind: 'robot', robotId: id }, state: 'all' }))).tasks
    const panel: RobotPanel = yield* call(() => robot(c, id).panel(access === 'owner', entry, tasks))
    return panel
  }))
  .on('GET', '/api/robots/:id/catalog', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => space(c.env).catalog(c.member.id, id)))))
  .on('PATCH', '/api/robots/:id/settings', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const patch = yield* decodeBody(c.request, SettingsPatch)
    if (patch.model !== undefined) {
      // A Robot is never switched to a model its owner has no credential for (robot-mx6s).
      const chosen = patch.model
      const current = yield* call(() => robot(c, id).settings())
      const refusal = yield* call(() => modelRefusal(c.env, c.member.id, current.model, chosen))
      if (refusal !== null) return yield* Effect.fail(badRequest(refusal))
    }
    return yield* call(() => robot(c, id).updateSettings(patch))
  }))
  .on('POST', '/api/robots/:id/proposals/:proposal', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const answer = yield* decodeBody(c.request, ProposalAnswer)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).answer(proposal, answer.revision, answer.approve, answer.approved, answer.scope, answer.note, { ...(answer.value === undefined ? {} : { value: answer.value }), ...(answer.values === undefined ? {} : { values: answer.values }), ...(answer.text === undefined ? {} : { text: answer.text }) }))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : result.reason === 'not-yours' ? forbidden('only the owner answers this Ask') : notFound('no such proposal'))
    return result.proposal
  }))
  // The owner edits a draft in its card before Send (v1.17, dp-qbt7); the answer is the Ask at its new revision.
  .on('PATCH', '/api/robots/:id/proposals/:proposal/draft', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const edit = yield* decodeBody(c.request, DraftEdit)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).editDraft(proposal, edit.revision, edit.body, edit.subject))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : notFound('no such Ask'))
    return result.proposal
  }))
  // "Always allow this" (v1.17, dp-u9z9): the Ask's items at ask go to allow for the Robot, then the stored call runs.
  .on('POST', '/api/robots/:id/proposals/:proposal/always-allow', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const { revision } = yield* decodeBody(c.request, AlwaysAllowAnswer)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).alwaysAllow(proposal, revision, c.member.name))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : notFound('no such Ask'))
    return result.proposal
  }))
  // Saving a credential Ask (v1.15 ticket 05): the form's password goes to the Space through this call and nowhere else.
  .on('POST', '/api/robots/:id/proposals/:proposal/credential', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const save = yield* decodeBody(c.request, CredentialSave)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).saveCredential(proposal, save.revision, save))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : result.reason === 'not-yours' ? forbidden('only the owner answers this Ask') : notFound('no such proposal'))
    return result.proposal
  }))
  .on('POST', '/api/robots/:id/help/:request', (c, { id, request }) => Effect.gen(function* () {
    yield* owner(c, id)
    const answer = yield* decodeBody(c.request, HelpAnswer)
    const result = yield* call((): Promise<HelpAnswerResult> => robot(c, id).answerHelp(request, answer.text, { by: 'owner', name: c.member.name }))
    if (result.ok) return result.proposal
    return yield* Effect.fail(result.reason === 'not-found' || result.reason === 'not-help' ? notFound('no such request for help') : result.reason === 'closed' ? conflict('this request is already answered') : badRequest('the answer needs text'))
  }))
  .on('POST', '/api/robots/:id/interrupt', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const { interrupted } = yield* call(() => robot(c, id).interrupt(c.member.name))
    return interrupted ? { ok: true } : yield* Effect.fail(conflict('this Robot is not working now'))
  }))
  // A Robot's Subagents (v1.14 ticket 06): listed, each with its own Chat and Trajectory, and stopped from there (ao-ce55).
  .on('GET', '/api/robots/:id/subagents', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).subagentList()))))
  .on('GET', '/api/robots/:id/subagents/:child/conversation', (c, { id, child }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).subagentConversation(child)))))
  .on('GET', '/api/robots/:id/subagents/:child/events', (c, { id, child }) => Effect.gen(function* () {
    yield* reach(c, id)
    const query = new URL(c.request.url).searchParams
    const number = (name: string) => (query.get(name) === null ? undefined : Number(query.get(name)))
    const page = yield* call(() => robot(c, id).subagentEvents(child, {
      ...(number('before') === undefined ? {} : { before: number('before')! }),
      ...(number('after') === undefined ? {} : { after: number('after')! }),
      ...(number('limit') === undefined ? {} : { limit: number('limit')! }),
    }))
    return new Response(`{"sessionId":${JSON.stringify(page.sessionId)},"hasMore":${page.hasMore},"events":${page.events}}`, { headers: { 'content-type': 'application/json' } })
  }))
  .on('POST', '/api/robots/:id/subagents/:child/interrupt', (c, { id, child }) => Effect.gen(function* () {
    yield* reach(c, id)
    const { interrupted } = yield* call(() => robot(c, id).interruptSubagent(child))
    return interrupted ? { ok: true } : yield* Effect.fail(conflict('this Subagent is not running'))
  }))
  // Stop the Robot's Box from its panel (ao-9q18): its kept folder is synced first.
  .on('POST', '/api/robots/:id/box/stop', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).stopBox()))))
  // Stop one job of the Box from the panel (v1.15 ticket 07, gb-66kh); the Robot is told.
  .on('POST', '/api/robots/:id/box/jobs/:job/stop', (c, { id, job }) => owner(c, id).pipe(Effect.andThen(Effect.gen(function* () {
    const jobId = parseJobId(decodeURIComponent(job))
    if (jobId === undefined) return yield* Effect.fail(notFound('no such job'))
    return yield* call(() => robot(c, id).stopBoxJob(jobId, c.member.name))
  }))))
  .on('POST', '/api/robots/:id/pause', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).pause()))))
  .on('POST', '/api/robots/:id/resume', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).resume()))))
  .on('DELETE', '/api/robots/:id', (c, { id }) => Effect.gen(function* () {
    const { confirm } = yield* decodeBody(c.request, Schema.Struct({ confirm: Schema.String }))
    yield* call(() => space(c.env).deleteRobot(c.member.id, id, confirm)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('POST', '/api/robots/:id/clear', (c, { id }) => Effect.gen(function* () {
    // The old body had a `memory` flag; it is ignored now: Clear history keeps every file (sk-8won).
    const { confirm } = yield* decodeBody(c.request, Schema.Struct({ confirm: Schema.String }))
    yield* call(() => space(c.env).clearRobot(c.member.id, id, confirm)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('POST', '/api/robots/:id/start-over', (c, { id }) => Effect.gen(function* () {
    const { confirm } = yield* decodeBody(c.request, Schema.Struct({ confirm: Schema.String }))
    yield* call(() => space(c.env).startOverRobot(c.member.id, id, confirm)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('POST', '/api/me/reset', (c) => Effect.gen(function* () {
    const { confirm } = yield* decodeBody(c.request, Schema.Struct({ confirm: Schema.String }))
    yield* call(() => space(c.env).resetMember(c.member.id, confirm)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))

  // ------------------------------------------------------------ Mission Control (v1.13 ticket 06)
  .on('GET', '/api/mission', (c) => {
    const query = new URL(c.request.url).searchParams
    const page = Number(query.get('fleetPage') ?? '1')
    const caller = taskCaller(c, query.get('scope') === 'home')
    return call((): Promise<MissionView> => space(c.env).mission(caller, { fleetQ: query.get('fleetQ') ?? '', fleetPage: Number.isInteger(page) && page >= 1 ? page : 1, tasks: taskFilter(query) }))
  })

  // ------------------------------------------------------------ Tasks (v1.13)
  // The active Members of the Space: who a Task can be given to (mc-n2bb).
  .on('GET', '/api/members', (c) => Effect.map(call(() => space(c.env).members()), (members) => members.filter((member) => member.status === 'active')))
  .on('GET', '/api/tasks', (c) => {
    const query = new URL(c.request.url).searchParams
    return call((): Promise<TaskPage> => space(c.env).listTasks(taskCaller(c, query.get('scope') === 'home'), taskFilter(query)))
  })
  .on('POST', '/api/tasks', (c) => Effect.gen(function* () {
    const input = yield* decodeBody(c.request, TaskInput)
    return yield* call((): Promise<TaskView> => space(c.env).createTask(taskCaller(c, false), input))
  }))
  .on('GET', '/api/tasks/:id', (c, { id }) => Effect.flatMap(taskCallerByPrefs(c), (caller) => call((): Promise<TaskView> => space(c.env).task(caller, id))))
  .on('PATCH', '/api/tasks/:id', (c, { id }) => Effect.gen(function* () {
    const patch = yield* decodeBody(c.request, TaskPatch)
    const caller = yield* taskCallerByPrefs(c)
    return yield* call((): Promise<TaskView> => space(c.env).updateTask(caller, id, patch))
  }))
  .on('POST', '/api/tasks/:id/done', (c, { id }) => Effect.flatMap(taskCallerByPrefs(c), (caller) => call((): Promise<TaskView> => space(c.env).finishTask(caller, id))))
  .on('POST', '/api/tasks/:id/cancel', (c, { id }) => Effect.flatMap(taskCallerByPrefs(c), (caller) => call((): Promise<TaskView> => space(c.env).cancelTask(caller, id))))
  .on('POST', '/api/tasks/:id/pause', (c, { id }) => Effect.gen(function* () {
    const { paused } = yield* decodeBody(c.request, TaskPause)
    const caller = yield* taskCallerByPrefs(c)
    return yield* call((): Promise<TaskView> => space(c.env).pauseTask(caller, id, paused))
  }))
  .on('POST', '/api/tasks/:id/run', (c, { id }) => Effect.flatMap(taskCallerByPrefs(c), (caller) => call((): Promise<TaskView> => space(c.env).runTask(caller, id))))
  .on('POST', '/api/tasks/:id/assign', (c, { id }) => Effect.gen(function* () {
    const { assignee } = yield* decodeBody(c.request, TaskAssign)
    const caller = yield* taskCallerByPrefs(c)
    return yield* call((): Promise<TaskView> => space(c.env).assignTask(caller, id, assignee))
  }))

  // ------------------------------------------------------------ admin (robot-x26m, robot-1rap, robot-d2uv)
  .on('GET', '/api/admin', (c) => admin(c).pipe(Effect.andThen(call(() => space(c.env).adminView(c.member.id)))))
  .on('GET', '/api/admin/members', (c) => admin(c).pipe(Effect.andThen(call(() => space(c.env).members()))))
  .on('POST', '/api/admin/members', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { email } = yield* decodeBody(c.request, Schema.Struct({ email: Schema.String }))
    if (!email.includes('@')) return yield* Effect.fail(badRequest('not an e-mail address'))
    return yield* call(() => space(c.env).invite(email))
  }))
  .on('DELETE', '/api/admin/members/:member', (c, { member }) => Effect.gen(function* () {
    yield* admin(c)
    if (member === c.member.id) return yield* Effect.fail(badRequest('you cannot remove yourself'))
    yield* call(() => space(c.env).remove(member))
    return { ok: true }
  }))

/** A Page's PDF as a download named by its title (dp-239c). */
export function pdfResponse(title: string, pdf: Uint8Array): Response {
  const name = `${title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120) || 'page'}.pdf`
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store' } })
}

const MAX_AVATAR_BYTES = 1024 * 1024
const AVATAR_KEY = /^avatar-[0-9a-f]{24}$/

type AvatarType = 'image/png' | 'image/jpeg' | 'image/webp'

/** The image type the bytes start with; the declared type is not trusted. */
function avatarType(bytes: Uint8Array): AvatarType | undefined {
  const starts = (offset: number, ...expected: number[]) => expected.every((byte, index) => bytes[offset + index] === byte)
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return undefined
}

/** An uploaded avatar picture, sent as the raw image or as the one file of a multipart form. */
function avatarPicture(request: Request): Effect.Effect<{ readonly bytes: Uint8Array; readonly contentType: AvatarType }, ApiError> {
  return Effect.gen(function* () {
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES + 64 * 1024) return yield* Effect.fail(badRequest('a picture is at most 1 MB'))
    const multipart = (request.headers.get('content-type') ?? '').startsWith('multipart/form-data')
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        if (!multipart) return new Uint8Array(await request.arrayBuffer())
        const file = [...(await request.formData()).values()].find((value): value is File => typeof value !== 'string')
        return file === undefined ? new Uint8Array() : new Uint8Array(await file.arrayBuffer())
      },
      catch: () => badRequest('the picture could not be read'),
    })
    if (bytes.byteLength === 0) return yield* Effect.fail(badRequest('send a picture'))
    if (bytes.byteLength > MAX_AVATAR_BYTES) return yield* Effect.fail(badRequest('a picture is at most 1 MB'))
    const contentType = avatarType(bytes)
    if (contentType === undefined) return yield* Effect.fail(badRequest('a picture is PNG, JPEG or WebP'))
    return { bytes, contentType }
  })
}

/** The picture's name: the same picture keeps the same key, a new one gets a new key (and a fresh cache). */
async function pictureHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function providerName(name: string, allowed: readonly ProviderId[]): Effect.Effect<ProviderId, ApiError> {
  return allowed.includes(name as ProviderId) ? Effect.succeed(name as ProviderId) : Effect.fail(notFound('no such Provider here'))
}

function fileName(name: string): Effect.Effect<MemberFileName, ApiError> {
  const decoded = decodeURIComponent(name)
  return (MEMBER_FILE_NAMES as readonly string[]).includes(decoded) ? Effect.succeed(decoded as MemberFileName) : Effect.fail(notFound('no such file'))
}

function conflictStale(): ApiError {
  return badRequestConflict('the proposal changed since you saw it; reload and answer the current one')
}

function badRequestConflict(message: string): ApiError {
  return new (badRequest('').constructor as new (args: { status: number; message: string }) => ApiError)({ status: 409, message })
}