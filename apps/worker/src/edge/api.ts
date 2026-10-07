/**
 * The HTTP API of the edge Worker. It holds no state: every call is routed to the
 * Durable Object that owns the data, after resolving the caller to a Member.
 */
import { MEMBER_FILE_NAMES, type MemberFileName } from '../member/member.ts'
import { probe } from '../browser/probe.ts'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import {
  LoginInput,
  BrowserBackend,
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
import { makeWorkspace, normalizePath } from '../workspace/workspace.ts'
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
    Effect.flatMap((file) => call(() => c.env.MEMBER.getByName(c.member.id).file(file)).pipe(Effect.map((content) => ({ name: file, content })))),
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
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return yield* Effect.fail(badRequest('login names use letters, digits, ".", "_" and "-"'))
    const { shared, ...patch } = yield* decodeBody(c.request, LoginInput)
    yield* call(() => home(c.env).putLogin(c.member.id, name, { ...patch, ...(patch.websites === undefined ? {} : { websites: patch.websites.map((site) => site.trim()).filter((site) => site !== '') }) }, shared)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('GET', '/api/secrets/:name/reveal', (c, { name }) => Effect.map(call(() => home(c.env).revealLogin(c.member.id, name)), (password) => ({ password })))
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
  .on('POST', '/api/admin/browser-probe', (c) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, Schema.Struct({ backend: BrowserBackend, url: Schema.String, waitMs: Schema.optional(Schema.Number) }))
    return yield* call(() => probe(c.env, input.backend, input.url, { vpn: () => home(c.env).vpnConfig(), proxy: () => home(c.env).proxyConfig() }, input.waitMs))
  }))
  // ------------------------------------------------------------ Hosts (v1.2)
  .on('GET', '/api/hosts', (c) => call(() => home(c.env).hostsFor(c.member.id)))
  .on('GET', '/api/hosts/pair/:code', (c, { code }) => call(() => home(c.env).pairingView(code)))
  .on('POST', '/api/hosts/pair/:code', (c, { code }) => call(() => home(c.env).approvePairing(code, c.member.id)))
  .on('PATCH', '/api/hosts/:id', (c, { id }) => Effect.gen(function* () {
    const { sharing } = yield* decodeBody(c.request, Schema.Struct({ sharing: Schema.Literals(['private', 'home']) }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setHostSharing(id, sharing))
    return { ok: true }
  }))
  .on('DELETE', '/api/hosts/:id', (c, { id }) => Effect.gen(function* () {
    const owner = yield* call(() => home(c.env).hostOwner(id))
    if (owner !== c.member.id && c.member.role !== 'admin') return yield* Effect.fail(forbidden('only the person who paired this host can unpair it'))
    yield* call(() => c.env.MEMBER.getByName(owner ?? c.member.id).unpairHost(id))
    return { ok: true }
  }))
  .on('GET', '/api/home-memory', (c) => call(async () => ({ content: await home(c.env).homeMemory() })))
  .on('PUT', '/api/admin/home-memory', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    yield* call(() => home(c.env).setHomeMemory(content, 'the Home admin', null))
    return { ok: true }
  }))
  .on('PUT', '/api/admin/proxy', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { url } = yield* decodeBody(c.request, Schema.Struct({ url: Schema.NullOr(Schema.String) }))
    yield* call(() => home(c.env).setProxyConfig(url)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true, configured: url !== null && url.trim() !== '' }
  }))
  .on('PUT', '/api/admin/exa', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { key } = yield* decodeBody(c.request, Schema.Struct({ key: Schema.NullOr(Schema.String) }))
    yield* call(() => home(c.env).setExaKey(key))
    return { ok: true, configured: key !== null && key.trim() !== '' }
  }))
  .on('PUT', '/api/admin/vpn', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { config } = yield* decodeBody(c.request, Schema.Struct({ config: Schema.NullOr(Schema.String) }))
    yield* call(() => home(c.env).setVpnConfig(config))
    return { ok: true, configured: config !== null && config.trim() !== '' }
  }))
  .on('POST', '/api/admin/models/refresh', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).refreshCatalogs(c.member.id)))))
  .on('GET', '/api/skills/:name', (c, { name }) => Effect.gen(function* () {
    const content = yield* call(() => home(c.env).skillContent(c.member.id, name))
    if (content === null) return yield* Effect.fail(notFound(`no skill "${name}"`))
    return { name, content }
  }))
  .on('PUT', '/api/admin/skills/:name', (c, { name }) => Effect.gen(function* () {
    yield* admin(c)
    const input = yield* decodeBody(c.request, Schema.Struct({ description: Schema.String, content: Schema.String }))
    yield* call(() => home(c.env).saveSkill(name, input.description, input.content, c.member.id)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return { ok: true }
  }))
  .on('DELETE', '/api/admin/skills/:name', (c, { name }) => admin(c).pipe(Effect.andThen(call(() => home(c.env).deleteSkill(name))), Effect.as({ ok: true })))
  .on('POST', '/api/admin/skills/sync', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).syncSkills()).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message))))))

  // ------------------------------------------------------------ Providers (robot-dic7, robot-lzu3, robot-7v9s)
  .on('GET', '/api/providers', (c) => call(() => home(c.env).providersView(c.member.id)))
  // OpenCode Go key pool (ticket 19)
  .on('GET', '/api/providers/opencode-go/keys', (c) => call(() => c.env.MEMBER.getByName(c.member.id).opencodeKeys()))
  .on('POST', '/api/providers/opencode-go/keys', (c) => Effect.gen(function* () {
    const input = yield* decodeBody(c.request, Schema.Struct({ key: Schema.String, shared: Schema.optional(Schema.Boolean) }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).addOpencodeKey(input.key, input.shared)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
    return yield* call(() => c.env.MEMBER.getByName(c.member.id).opencodeKeys())
  }))
  .on('POST', '/api/providers/opencode-go/keys/:key/activate', (c, { key }) => call(() => c.env.MEMBER.getByName(c.member.id).activateOpencodeKey(key)).pipe(
    Effect.mapError((error) => badRequest(error.detail ?? error.message)),
    Effect.andThen(call(() => c.env.MEMBER.getByName(c.member.id).opencodeKeys())),
  ))
  .on('DELETE', '/api/providers/opencode-go/keys/:key', (c, { key }) => call(() => c.env.MEMBER.getByName(c.member.id).removeOpencodeKey(key)).pipe(
    Effect.andThen(call(() => c.env.MEMBER.getByName(c.member.id).opencodeKeys())),
  ))
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
      Effect.mapError((error) => badRequest(error.detail ?? error.message)),
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
  .on('GET', '/api/robots', (c) => call(async () => {
    const [robots, prefs] = await Promise.all([home(c.env).reachable(c.member.id), c.env.MEMBER.getByName(c.member.id).listPrefs()])
    return robots.map((summary) => {
      const pref = prefs[summary.id]
      // Unread: newer than when this person last opened it, or marked unread by them (robot-mktj).
      const unread = pref?.markedUnread === true || (pref?.seenAt != null && summary.lastAt > pref.seenAt)
      return { ...summary, unread, pinned: pref?.pinned === true, hidden: pref?.hidden === true }
    })
  }))
  .on('POST', '/api/robots/:id/list', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const change = yield* decodeBody(c.request, Schema.Struct({ pinned: Schema.optional(Schema.Boolean), hidden: Schema.optional(Schema.Boolean), unread: Schema.optional(Schema.Boolean) }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).setListPref(id, change))
    return { ok: true }
  }))
  .on('POST', '/api/robots/:id/routines/:routine/pause', (c, { id, routine }) => Effect.gen(function* () {
    yield* owner(c, id)
    const { paused } = yield* decodeBody(c.request, Schema.Struct({ paused: Schema.Boolean }))
    return yield* call(() => robot(c, id).pauseRoutine(routine, paused)).pipe(Effect.mapError((error) => notFound(error.detail ?? error.message)))
  }))
  .on('POST', '/api/robots', (c) => Effect.gen(function* () {
    const { brief, model } = yield* decodeBody(c.request, Schema.Struct({
      brief: Schema.optional(Schema.String),
      model: Schema.optional(Schema.Struct({ provider: Schema.String, model: Schema.String, effort: Schema.String })),
    }))
    return yield* call(() => home(c.env).createRobot(c.member.id, brief, model as import('@mr-robot/protocol').ModelChoice | undefined)).pipe(Effect.mapError((error) => badRequest(error.detail ?? error.message)))
  }))
  .on('GET', '/api/robots/:id/conversation', (c, { id }) => reach(c, id).pipe(
    Effect.andThen(call(() => robot(c, id).conversationView())),
    Effect.tap(() => call(() => c.env.MEMBER.getByName(c.member.id).markSeen(id, Date.now()))),
  ))
  .on('GET', '/api/robots/:id/trajectory', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).trajectoryMasked()))))
  .on('POST', '/api/robots/:id/rewind', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const input = yield* decodeBody(c.request, RewindRequest)
    if (input.beforeTurn === undefined && input.atSeq === undefined) return yield* Effect.fail(badRequest('give atSeq or beforeTurn'))
    return yield* call(() => (input.beforeTurn !== undefined ? robot(c, id).rewindBeforeTurn(input.beforeTurn) : robot(c, id).rewind(input.atSeq!))).pipe(Effect.mapError((error) => conflict(error.detail ?? error.message)))
  }))
  .on('POST', '/api/robots/:id/rewinds/:rewind/undo', (c, { id, rewind }) => owner(c, id).pipe(
    Effect.andThen(call(() => robot(c, id).undoRewind(rewind)).pipe(Effect.mapError((error) => conflict(error.detail ?? error.message)))),
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
    const path = yield* call(() => robot(c, id).screenPath())
    if (path === null) return yield* Effect.fail(notFound('no screen yet'))
    const file = yield* makeWorkspace(c.env.FILES, id).read(path).pipe(Effect.mapError(() => notFound('no screen yet')))
    if (file === undefined) return yield* Effect.fail(notFound('no screen yet'))
    return new Response(file.body, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=31536000, immutable' } })
  }))
  // ------------------------------------------------------------ Files view (v1.1 ticket 08)
  .on('GET', '/api/robots/:id/files', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    return yield* call(() => robot(c, id).files())
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
  .on('DELETE', '/api/robots/:id/file', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const path = normalizePath(new URL(c.request.url).searchParams.get('path') ?? '')
    if (path === undefined) return yield* Effect.fail(badRequest('a path inside the Workspace'))
    yield* call(() => robot(c, id).deleteFile(path))
    return { ok: true }
  }))
  .on('GET', '/api/robots/:id/prompt', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).promptPreview()))))
  .on('POST', '/api/robots/:id/retry', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).retry())), Effect.map((retried) => ({ retried }))))
  .on('GET', '/api/robots/:id/events', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const query = new URL(c.request.url).searchParams
    const number = (name: string) => (query.get(name) === null ? undefined : Number(query.get(name)))
    const page = yield* call(() => robot(c, id).sessionEvents({
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
    const entry = (yield* call(() => home(c.env).reachable(c.member.id))).find((summary) => summary.id === id)
    if (entry === undefined) return yield* Effect.fail(notFound())
    const panel: RobotPanel = yield* call(() => robot(c, id).panel(access === 'owner', entry))
    return panel
  }))
  .on('GET', '/api/robots/:id/catalog', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => home(c.env).catalog(c.member.id, id)))))
  .on('PATCH', '/api/robots/:id/settings', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const patch = yield* decodeBody(c.request, SettingsPatch)
    if (patch.model !== undefined) {
      // A Robot is never switched to a model its owner has no credential for (robot-mx6s).
      const chosen = patch.model
      const current = yield* call(() => robot(c, id).settings())
      const changed = current.model.provider !== chosen.provider || current.model.model !== chosen.model
      if (changed && (PROVIDER_IDS as readonly string[]).includes(chosen.provider)) {
        const offered = yield* call(() => home(c.env).models(c.member.id))
        if (!offered.some((option) => option.provider === chosen.provider && option.model === chosen.model)) {
          return yield* Effect.fail(badRequest(`${chosen.model} is not offered to you: connect its Provider under your name → Providers first`))
        }
      }
    }
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
  .on('GET', '/api/admin', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).adminView(c.member.id)))))
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