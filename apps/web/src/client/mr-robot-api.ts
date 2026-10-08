/**
 * The Mr. Robot API as one Effect service (fe-tln3): every request goes through Effect HttpClient
 * and every response is decoded with its Schema from @mr-robot/protocol. Failures are ApiFailure values.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import {
  AdminView, Attachment, ConfiguredResult, Conversation, CreatedRobot, HomeSettingsView, HostAction, HostPaired, HostPairing, HostView,
  LoginView, Me, MemberView, ModelListRefresh, NamedText, OAuthFinished, OAuthStart, OpencodeKeysView, PromptPreview, ProposalView,
  ProvidersView, RetryResult, RevealedLogin, RobotPanel, RobotSettings, SessionEventsPage, RobotSummary, RoutineView, SettingsCatalog, SkillsSynced,
  TextContent, Trajectory, WorkspaceFileContent, WorkspaceFileView,
  type ModelChoice, type SendMessage, type SettingsPatch,
} from '@mr-robot/protocol'
import { ApiRejected, ApiResponseInvalid, ApiUnreachable, type ApiFailure } from './api-failure.ts'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Call<A> = Effect.Effect<A, ApiFailure>

const Ignored = Schema.Unknown
const ErrorBody = Schema.Struct({ error: Schema.optional(Schema.String) })
const enc = encodeURIComponent

export type LoginChange = { readonly username?: string; readonly password?: string; readonly websites?: readonly string[]; readonly notes?: string; readonly allowRead?: boolean; readonly shared: boolean }
export type ListPrefChange = { readonly pinned?: boolean; readonly hidden?: boolean; readonly unread?: boolean }
export type MePatch = Partial<Pick<Me, 'name' | 'timeZone' | 'quietHours' | 'workDetails'>>

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  /** One request: JSON in, the Schema-decoded body out; a non-2xx status is ApiRejected with the server's message. */
  const request = <S extends Schema.Top>(schema: S, method: Method, path: string, body?: unknown, raw?: { readonly bytes: Uint8Array; readonly contentType: string }): Call<S['Type']> => Effect.gen(function* () {
    let req = HttpClientRequest.make(method)(path)
    if (raw !== undefined) req = HttpClientRequest.bodyUint8Array(req, raw.bytes, raw.contentType)
    else if (body !== undefined) req = HttpClientRequest.bodyJsonUnsafe(req, body)
    const response = yield* client.execute(req).pipe(Effect.mapError((cause) => new ApiUnreachable({ path, cause })))
    const json = yield* response.json.pipe(Effect.orElseSucceed(() => ({}) as unknown))
    if (response.status < 200 || response.status >= 300) {
      const parsed = Schema.decodeUnknownOption(ErrorBody)(json)
      const message = parsed._tag === 'Some' && parsed.value.error !== undefined ? parsed.value.error : `request failed (${response.status})`
      return yield* new ApiRejected({ status: response.status, message })
    }
    return yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError((cause) => new ApiResponseInvalid({ path, cause })))
  }) as Call<S['Type']>
  const get = <S extends Schema.Top>(schema: S, path: string) => request(schema, 'GET', path)
  const send = (method: Method, path: string, body?: unknown) => Effect.asVoid(request(Ignored, method, path, body ?? (method === 'DELETE' ? undefined : {})))

  return {
    me: get(Me, '/api/me'),
    updateMe: (patch: MePatch) => send('PATCH', '/api/me', patch),
    memberFile: (name: string) => get(NamedText, `/api/me/files/${enc(name)}`),
    writeMemberFile: (name: string, content: string) => send('PUT', `/api/me/files/${enc(name)}`, { content }),
    resetEverything: (confirm: string) => send('POST', '/api/me/reset', { confirm }),

    robots: get(Schema.Array(RobotSummary), '/api/robots'),
    createRobot: (input: { readonly brief?: string; readonly model?: ModelChoice }) => request(CreatedRobot, 'POST', '/api/robots', input),
    conversation: (id: string, details: boolean) => get(Conversation, `/api/robots/${enc(id)}/conversation${details ? '?details=1' : ''}`),
    trajectory: (id: string) => get(Trajectory, `/api/robots/${enc(id)}/trajectory`),
    /** A page of raw session events: the latest (no cursor), newer than after, or older than before. */
    events: (id: string, page: { readonly before?: number; readonly after?: number; readonly limit: number }) =>
      get(SessionEventsPage, `/api/robots/${enc(id)}/events?limit=${page.limit}${page.before === undefined ? '' : `&before=${page.before}`}${page.after === undefined ? '' : `&after=${page.after}`}`),
    panel: (id: string) => get(RobotPanel, `/api/robots/${enc(id)}/panel`),
    catalog: (id: string) => get(SettingsCatalog, `/api/robots/${enc(id)}/catalog`),
    prompt: (id: string) => get(PromptPreview, `/api/robots/${enc(id)}/prompt`),
    send: (id: string, message: SendMessage) => send('POST', `/api/robots/${enc(id)}/messages`, message),
    retry: (id: string) => request(RetryResult, 'POST', `/api/robots/${enc(id)}/retry`, {}),
    updateSettings: (id: string, patch: SettingsPatch) => request(RobotSettings, 'PATCH', `/api/robots/${enc(id)}/settings`, patch),
    answer: (id: string, proposal: ProposalView, approve: boolean) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}`, { revision: proposal.revision, approve }),
    pause: (id: string) => send('POST', `/api/robots/${enc(id)}/pause`),
    resume: (id: string) => send('POST', `/api/robots/${enc(id)}/resume`),
    remove: (id: string, confirm: string) => send('DELETE', `/api/robots/${enc(id)}`, { confirm }),
    clearHistory: (id: string, confirm: string, memory: boolean) => send('POST', `/api/robots/${enc(id)}/clear`, { confirm, memory }),
    listPref: (id: string, change: ListPrefChange) => send('POST', `/api/robots/${enc(id)}/list`, change),
    pauseRoutine: (id: string, routine: string, paused: boolean) => request(RoutineView, 'POST', `/api/robots/${enc(id)}/routines/${enc(routine)}/pause`, { paused }),
    deleteRoutine: (id: string, routine: string) => send('DELETE', `/api/robots/${enc(id)}/routines/${enc(routine)}`),
    rewind: (id: string, atSeq: number) => send('POST', `/api/robots/${enc(id)}/rewind`, { atSeq }),
    rewindBeforeTurn: (id: string, turn: number) => send('POST', `/api/robots/${enc(id)}/rewind`, { beforeTurn: turn }),
    undoRewind: (id: string, rewind: string) => send('POST', `/api/robots/${enc(id)}/rewinds/${enc(rewind)}/undo`),
    upload: (id: string, file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array }) =>
      request(Attachment, 'PUT', `/api/robots/${enc(id)}/files?name=${enc(file.name)}`, undefined, { bytes: file.bytes, contentType: file.type || 'application/octet-stream' }),
    files: (id: string) => get(Schema.Array(WorkspaceFileView), `/api/robots/${enc(id)}/files`),
    file: (id: string, path: string) => get(WorkspaceFileContent, `/api/robots/${enc(id)}/file?path=${enc(path)}`),
    saveFile: (id: string, path: string, content: string) => request(WorkspaceFileContent, 'PUT', `/api/robots/${enc(id)}/file?path=${enc(path)}`, { content }),
    deleteFile: (id: string, path: string) => send('DELETE', `/api/robots/${enc(id)}/file?path=${enc(path)}`),

    subscribePush: (subscription: PushSubscriptionJSON, device: string) => send('POST', '/api/push/subscriptions', { ...subscription, device }),
    unsubscribePush: (endpoint: string) => send('DELETE', '/api/push/subscriptions', { endpoint }),

    secrets: get(Schema.Array(LoginView), '/api/secrets'),
    putLogin: (name: string, input: LoginChange) => send('PUT', `/api/secrets/${enc(name)}`, input),
    revealLogin: (name: string) => get(RevealedLogin, `/api/secrets/${enc(name)}/reveal`),
    deleteSecret: (name: string) => send('DELETE', `/api/secrets/${enc(name)}`),

    skill: (name: string) => get(NamedText, `/api/skills/${enc(name)}`),
    saveSkill: (name: string, description: string, content: string) => send('PUT', `/api/admin/skills/${enc(name)}`, { description, content }),
    deleteSkill: (name: string) => send('DELETE', `/api/admin/skills/${enc(name)}`),

    providers: get(ProvidersView, '/api/providers'),
    setApiKey: (provider: string, key: string, shared: boolean) => send('PUT', `/api/providers/${enc(provider)}`, { key, shared }),
    startOAuth: (provider: string) => request(OAuthStart, 'POST', `/api/providers/${enc(provider)}/oauth/start`, {}),
    finishOAuth: (provider: string, shared: boolean, pasted?: string) => request(OAuthFinished, 'POST', `/api/providers/${enc(provider)}/oauth/finish`, pasted === undefined ? { shared } : { shared, pasted }),
    shareProvider: (provider: string, shared: boolean) => send('PATCH', `/api/providers/${enc(provider)}`, { shared }),
    removeProvider: (provider: string) => send('DELETE', `/api/providers/${enc(provider)}`),
    opencodeKeys: get(OpencodeKeysView, '/api/providers/opencode-go/keys'),
    addOpencodeKey: (key: string) => request(OpencodeKeysView, 'POST', '/api/providers/opencode-go/keys', { key }),
    activateOpencodeKey: (id: string) => request(OpencodeKeysView, 'POST', `/api/providers/opencode-go/keys/${enc(id)}/activate`, {}),
    removeOpencodeKey: (id: string) => request(OpencodeKeysView, 'DELETE', `/api/providers/opencode-go/keys/${enc(id)}`),

    admin: get(AdminView, '/api/admin'),
    homeSettings: get(HomeSettingsView, '/api/admin/settings'),
    updateHomeSettings: (patch: Record<string, unknown>) => send('PATCH', '/api/admin/settings', patch),
    setSkillRepository: (input: { readonly repo: string; readonly ref: string; readonly path: string; readonly token?: string }) => send('PUT', '/api/admin/skills/repository', input),
    homeMemory: get(TextContent, '/api/home-memory'),
    setHomeMemory: (content: string) => send('PUT', '/api/admin/home-memory', { content }),
    setProxy: (url: string | null) => request(ConfiguredResult, 'PUT', '/api/admin/proxy', { url }),
    setExaKey: (key: string | null) => request(ConfiguredResult, 'PUT', '/api/admin/exa', { key }),
    setVpnConfig: (config: string | null) => request(ConfiguredResult, 'PUT', '/api/admin/vpn', { config }),
    refreshModels: request(ModelListRefresh, 'POST', '/api/admin/models/refresh', {}),
    syncSkills: request(SkillsSynced, 'POST', '/api/admin/skills/sync', {}),
    members: get(Schema.Array(MemberView), '/api/admin/members'),
    invite: (email: string) => request(MemberView, 'POST', '/api/admin/members', { email }),
    removeMember: (id: string) => send('DELETE', `/api/admin/members/${enc(id)}`),

    hosts: get(Schema.Array(HostView), '/api/hosts'),
    pairing: (code: string) => get(HostPairing, `/api/hosts/pair/${enc(code)}`),
    approvePairing: (code: string) => request(HostPaired, 'POST', `/api/hosts/pair/${enc(code)}`, {}),
    setHostSharing: (id: string, sharing: 'private' | 'home') => send('PATCH', `/api/hosts/${enc(id)}`, { sharing }),
    unpairHost: (id: string) => send('DELETE', `/api/hosts/${enc(id)}`),
    hostActions: (id: string) => get(Schema.Array(HostAction), `/api/hosts/${enc(id)}/actions`),
  }
})

export class MrRobotApi extends Context.Service<MrRobotApi, Effect.Success<typeof make>>()('mr-robot/MrRobotApi') {
  /** The browser's fetch, same origin: the Access session cookie goes with every request. */
  static readonly layer: Layer.Layer<MrRobotApi> = Layer.effect(MrRobotApi, make).pipe(
    Layer.provide(FetchHttpClient.layer),
    // fetch is looked up at each call, not captured once when the layer is built.
    // SAFETY: the arrow has fetch's call signature; the cast only adds fetch's static members (preconnect), which HttpClient never uses.
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch)),
  )
}

/** Where a Workspace file is served for preview or download (pl-ojbr); a plain URL for img, iframe and links. */
export function rawFileUrl(robotId: string, path: string, download = false): string {
  return `/api/robots/${enc(robotId)}/raw?path=${enc(path)}${download ? '&download=1' : ''}`
}
