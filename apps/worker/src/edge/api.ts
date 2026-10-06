/**
 * The HTTP API of the edge Worker. It holds no state: every call is routed to the
 * Durable Object that owns the data, after resolving the caller to a Member.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import {
  MemberPreferences,
  ApiKeyInput,
  HomeSettingsPatch,
  OAuthFinish,
  ProposalAnswer,
  PushSubscriptionInput,
  ShareInput,
  SkillRepositoryInput,
  RewindRequest,
  SendMessage,
  SettingsPatch,
  type Attachment,
  type Me,
  type MemberView,
  type RobotPanel,
} from '@mr-robot/protocol'
import { HOME_ID, type Env } from '../env.ts'
import { makeWorkspace } from '../workspace/workspace.ts'
import { API_KEY_PROVIDERS, OAUTH_PROVIDERS, PROVIDER_IDS, type ProviderId } from '../agent/providers.ts'
import type { AnswerResult } from '../robot/robot.ts'
import { badRequest, call, conflict, decodeBody, forbidden, notFound, Router, type ApiError } from './http.ts'

export interface ApiContext {
  readonly request: Request
  readonly env: Env
  readonly ctx: ExecutionContext
  readonly member: MemberView
}

const home = (env: Env) => env.HOME.getByName(HOME_ID)
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** The caller may use this Robot (owner, or shared with the Home); returns how. */
function reach(c: ApiContext, robotId: string): Effect.Effect<'owner' | 'shared', ApiError> {
  return call(() => home(c.env).access(c.member.id, robotId)).pipe(
    Effect.flatMap((access) => access === null ? Effect.fail(notFound('no such robot')) : Effect.succeed(access)),
  )
}

function owner(c: ApiContext, robotId: string): Effect.Effect<void, ApiError> {
  return reach(c, robotId).pipe(Effect.flatMap((access) => access === 'owner' ? Effect.void : Effect.fail(forbidden('only the owner can do that'))))
}

function admin(c: ApiContext): Effect.Effect<void, ApiError> {
  return c.member.role === 'admin' ? Effect.void : Effect.fail(forbidden('admin only'))
}

const robot = (c: ApiContext, id: string) => c.env.ROBOT.getByName(id)

export const api = new Router<ApiContext>()
  // ------------------------------------------------------------ me
  .on('GET', '/api/me', (c) => call(async (): Promise<Me> => {
    const profile = await c.env.MEMBER.getByName(c.member.id).profile()
    return { ...c.member, home: c.env.HOME_NAME, timeZone: profile.timeZone, quietHours: profile.quietHours, vapidPublicKey: c.env.VAPID_PUBLIC_KEY }
  }))
  .on('PATCH', '/api/me', (c) => Effect.gen(function* () {
    const patch = yield* decodeBody(c.request, MemberPreferences)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).updateProfile(patch))
    if (patch.name !== undefined) yield* call(() => home(c.env).rename(c.member.id, patch.name!))
    return { ok: true }
  }))
  .on('GET', '/api/me/files/:name', (c, { name }) => fileName(name).pipe(
    Effect.flatMap((file) => call(() => c.env.MEMBER.getByName(c.member.id).file(file))),
    Effect.map((content) => ({ name, content })),
  ))
  .on('PUT', '/api/me/files/:name', (c, { name }) => Effect.gen(function* () {
    const file = yield* fileName(name)
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).writeFile(file, content))
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
  .on('GET', '/api/secrets', (c) => call(() => home(c.env).secretsView(c.member.id)))
  .on('PUT', '/api/secrets/:name', (c, { name }) => Effect.gen(function* () {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return yield* Effect.fail(badRequest('secret names use letters, digits, ".", "_" and "-"'))
    const input = yield* decodeBody(c.request, Schema.Struct({ value: Schema.optional(Schema.String), shared: Schema.Boolean }))
    yield* call(() => home(c.env).putSecret(c.member.id, name, input.value, input.shared)).pipe(Effect.mapError((error) => badRequest(error.message)))
    return { ok: true }
  }))
  .on('DELETE', '/api/secrets/:name', (c, { name }) => call(() => home(c.env).deleteSecret(c.member.id, name)))

  // ------------------------------------------------------------ skill library (robot-7qpi, robot-qjvu)
  .on('GET', '/api/skills', (c) => call(async () => ({ skills: await home(c.env).skills(c.member.id), repository: await home(c.env).skillRepository() })))
  .on('PUT', '/api/admin/skills/repository', (c) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, SkillRepositoryInput)
    if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo)) return yield* Effect.fail(badRequest('the repository is owner/name on GitHub'))
    yield* call(() => home(c.env).setSkillRepository({ repo: input.repo, ref: input.ref || 'main', path: input.path }, input.token))
    return { ok: true }
  }))
  .on('POST', '/api/admin/skills/sync', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).syncSkills()).pipe(Effect.mapError((error) => badRequest(error.message))))))

  // ------------------------------------------------------------ Providers (robot-dic7, robot-lzu3, robot-7v9s)
  .on('GET', '/api/providers', (c) => call(() => home(c.env).providersView(c.member.id)))
  .on('PUT', '/api/providers/:provider', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, API_KEY_PROVIDERS)
    const input = yield* decodeBody(c.request, ApiKeyInput)
    if (input.key.trim().length < 8) return yield* Effect.fail(badRequest('that does not look like an API key'))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setApiKey(name, input.key.trim(), input.shared))
    return { ok: true }
  }))
  .on('POST', '/api/providers/:provider/oauth/start', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, OAUTH_PROVIDERS)
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).startOAuth(name as 'openai' | 'anthropic'))
  }))
  .on('POST', '/api/providers/:provider/oauth/finish', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, OAUTH_PROVIDERS)
    const input = yield* decodeBody(c.request, OAuthFinish)
    const connected = yield* call(() => c.env.MEMBER.getByName(c.member.id).finishOAuth(name as 'openai' | 'anthropic', input.pasted, input.shared)).pipe(
      Effect.mapError((error) => badRequest(error.message)),
    )
    return { connected }
  }))
  .on('PATCH', '/api/providers/:provider', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, PROVIDER_IDS)
    const { shared } = yield* decodeBody(c.request, ShareInput)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setShared(name, shared))
    return { ok: true }
  }))
  .on('DELETE', '/api/providers/:provider', (c, { provider }) => Effect.gen(function* () {
    const name = yield* providerName(provider, PROVIDER_IDS)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).removeCredential(name))
    return { ok: true }
  }))
  .on('GET', '/api/admin/settings', (c) => admin(c).pipe(Effect.andThen(call(async () => ({ ...(await home(c.env).settings()), models: await home(c.env).modelList() })))))
  .on('PATCH', '/api/admin/settings', (c) => Effect.gen(function* () {
    yield* admin(c)
    const patch = yield* decodeBody(c.request, HomeSettingsPatch)
    return yield* call(() => home(c.env).updateSettings(patch))
  }))

  // ------------------------------------------------------------ robots
  .on('GET', '/api/robots', (c) => call(() => home(c.env).reachable(c.member.id)))
  .on('POST', '/api/robots', (c) => Effect.gen(function* () {
    const { brief } = yield* decodeBody(c.request, Schema.Struct({ brief: Schema.optional(Schema.String) }))
    return yield* call(() => home(c.env).createRobot(c.member.id, brief))
  }))
  .on('GET', '/api/robots/:id/conversation', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).conversationView()))))
  .on('GET', '/api/robots/:id/trajectory', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).trajectoryMasked()))))
  .on('POST', '/api/robots/:id/rewind', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const { atSeq } = yield* decodeBody(c.request, RewindRequest)
    return yield* call(() => robot(c, id).rewind(atSeq)).pipe(Effect.mapError((error) => conflict(error.message)))
  }))
  .on('POST', '/api/robots/:id/rewinds/:rewind/undo', (c, { id, rewind }) => owner(c, id).pipe(
    Effect.andThen(call(() => robot(c, id).undoRewind(rewind)).pipe(Effect.mapError((error) => conflict(error.message)))),
  ))
  .on('POST', '/api/robots/:id/messages', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const message = yield* decodeBody(c.request, SendMessage)
    if (message.text.trim() === '' && (message.attachments ?? []).length === 0) return yield* Effect.fail(badRequest('empty message'))
    const sender = { kind: 'member' as const, memberId: c.member.id, name: c.member.name }
    const wakeup = yield* call(() => robot(c, id).wake({ kind: 'member', sender, text: message.text, attachments: message.attachments ?? [] }))
    return { wakeup }
  }))
  .on('PUT', '/api/robots/:id/files', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const name = new URL(c.request.url).searchParams.get('name') ?? ''
    const safe = name.replace(/[\\/]/g, '_').replace(/^\.+/, '').slice(0, 200)
    if (safe === '' || c.request.body === null) return yield* Effect.fail(badRequest('a file name and body are required'))
    const size = Number(c.request.headers.get('content-length') ?? '0')
    if (size > MAX_ATTACHMENT_BYTES) return yield* Effect.fail(badRequest('files up to 50 MB'))
    const contentType = c.request.headers.get('content-type') ?? 'application/octet-stream'
    const path = `attachments/${new Date().toISOString().slice(0, 10)}/${Date.now().toString(36)}-${safe}`
    const entry = yield* makeWorkspace(c.env.FILES, id).write(path, c.request.body, contentType).pipe(Effect.mapError((error) => badRequest(error.message)))
    const attachment: Attachment = { name: safe, path: entry.path, size: entry.size, contentType }
    return attachment
  }))
  .on('GET', '/api/robots/:id/panel', (c, { id }) => Effect.gen(function* () {
    const access = yield* reach(c, id)
    const entry = (yield* call(() => home(c.env).reachable(c.member.id))).find((summary) => summary.id === id)
    if (entry === undefined) return yield* Effect.fail(notFound())
    const panel: RobotPanel = yield* call(() => robot(c, id).panel(access === 'owner', entry))
    return panel
  }))
  .on('GET', '/api/robots/:id/catalog', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => home(c.env).catalog(c.member.id, id)))))
  .on('PATCH', '/api/robots/:id/settings', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const patch = yield* decodeBody(c.request, SettingsPatch)
    return yield* call(() => robot(c, id).updateSettings(patch))
  }))
  .on('POST', '/api/robots/:id/proposals/:proposal', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const answer = yield* decodeBody(c.request, ProposalAnswer)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).answer(proposal, answer.revision, answer.approve))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : notFound('no such proposal'))
    return result.proposal
  }))
  .on('DELETE', '/api/robots/:id/routines/:routine', (c, { id, routine }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).removeRoutine(routine)))))
  .on('POST', '/api/robots/:id/pause', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).pause()))))
  .on('POST', '/api/robots/:id/resume', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).resume()))))
  .on('DELETE', '/api/robots/:id', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).remove()))))

  // ------------------------------------------------------------ admin (robot-x26m, robot-1rap, robot-d2uv)
  .on('GET', '/api/admin/members', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).members()))))
  .on('POST', '/api/admin/members', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { email } = yield* decodeBody(c.request, Schema.Struct({ email: Schema.String }))
    if (!email.includes('@')) return yield* Effect.fail(badRequest('not an e-mail address'))
    return yield* call(() => home(c.env).invite(email))
  }))
  .on('DELETE', '/api/admin/members/:member', (c, { member }) => Effect.gen(function* () {
    yield* admin(c)
    if (member === c.member.id) return yield* Effect.fail(badRequest('you cannot remove yourself'))
    yield* call(() => home(c.env).remove(member))
    return { ok: true }
  }))

function providerName(name: string, allowed: readonly ProviderId[]): Effect.Effect<ProviderId, ApiError> {
  return allowed.includes(name as ProviderId) ? Effect.succeed(name as ProviderId) : Effect.fail(notFound('no such Provider here'))
}

function fileName(name: string): Effect.Effect<'USER.md' | 'PROACTIVE_PREFERENCES.md', ApiError> {
  return name === 'USER.md' || name === 'PROACTIVE_PREFERENCES.md' ? Effect.succeed(name) : Effect.fail(notFound('no such file'))
}

function conflictStale(): ApiError {
  return badRequestConflict('the proposal changed since you saw it; reload and answer the current one')
}

function badRequestConflict(message: string): ApiError {
  return new (badRequest('').constructor as new (args: { status: number; message: string }) => ApiError)({ status: 409, message })
}