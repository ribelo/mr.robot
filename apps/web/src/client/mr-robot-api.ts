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
  AdminView, Attachment, ConnectionNote, ConnectionView, PluginView, ConfiguredResult, Conversation, CreatedRobot, HomeSettingsSaved, HomeSettingsView, HostAction, HostPaired, HostPairing, HostView,
  LoginView, Me, MemberAvatar, MemberCosts, MemberView, SubagentView, ModelListRefresh, NamedText, OAuthFinished, OAuthStart, PromptPreview, ProposalView,
  AccountUsage, ProvidersView, RetryResult, RevealedLogin, RobotGroup, RobotPanel, RobotSettings, SessionEventsPage, RobotSummary, SettingsCatalog, SkillsSynced, TaskPage, TaskView, MissionView,
  SessionCapture, SessionCaptureStarted, TextContent, Trajectory, WebhookView, WorkspaceFileContent, WorkspaceFileView,
  type CredentialSave, type GroupPatch, type HomeSettingsPatch, type TaskAssignee, type TaskInput, type TaskPatch, type ListPrefPatch, type MePatch, type ModelChoice, type SendMessage, type SettingsPatch,
} from '@mr-robot/protocol'
import { ApiRejected, ApiResponseInvalid, ApiUnreachable, type ApiFailure } from './api-failure.ts'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Call<A> = Effect.Effect<A, ApiFailure>

const Ignored = Schema.Unknown
const ErrorBody = Schema.Struct({ error: Schema.optional(Schema.String) })
const enc = encodeURIComponent

export type LoginChange = { readonly username?: string; readonly password?: string; readonly websites?: readonly string[]; readonly notes?: string; readonly allowRead?: boolean; readonly shared: boolean }

/** The zone this app runs in: the browser's in the PWA, the system's in the desktop app (its renderer is a browser). */
const appTimeZone = (): string | undefined => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  /** One request: JSON in, the Schema-decoded body out; a non-2xx status is ApiRejected with the server's message. */
  const request = <S extends Schema.Top>(schema: S, method: Method, path: string, body?: unknown, raw?: { readonly bytes: Uint8Array; readonly contentType: string }, headers?: Record<string, string>): Call<S['Type']> => Effect.gen(function* () {
    let req = HttpClientRequest.make(method)(path)
    if (headers !== undefined) req = HttpClientRequest.setHeaders(req, headers)
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
    // The app tells the server where the person is each time it asks who they are.
    me: Effect.suspend(() => {
      const zone = appTimeZone()
      return request(Me, 'GET', '/api/me', undefined, undefined, zone === undefined ? undefined : { 'X-Time-Zone': zone })
    }),
    updateMe: (patch: MePatch) => send('PATCH', '/api/me', patch),
    memberFile: (name: string) => get(NamedText, `/api/me/files/${enc(name)}`),
    writeMemberFile: (name: string, content: string) => send('PUT', `/api/me/files/${enc(name)}`, { content }),
    resetEverything: (confirm: string) => send('POST', '/api/me/reset', { confirm }),
    /** A picture already resized by the app (ux-s88l); the answer is the avatar now. */
    uploadAvatar: (picture: { readonly bytes: Uint8Array; readonly type: string }) => request(MemberAvatar, 'PUT', '/api/me/avatar', undefined, { bytes: picture.bytes, contentType: picture.type }),
    removeAvatar: request(MemberAvatar, 'DELETE', '/api/me/avatar'),

    robots: get(Schema.Array(RobotSummary), '/api/robots'),
    createRobot: (input: { readonly brief?: string; readonly model?: ModelChoice }) => request(CreatedRobot, 'POST', '/api/robots', input),
    conversation: (id: string, details: boolean) => get(Conversation, `/api/robots/${enc(id)}/conversation${details ? '?details=1' : ''}`),
    trajectory: (id: string) => get(Trajectory, `/api/robots/${enc(id)}/trajectory`),
    /** A page of raw session events: the latest (no cursor), newer than after, or older than before. */
    events: (id: string, page: { readonly before?: number; readonly after?: number; readonly limit: number }, child?: string) =>
      get(SessionEventsPage, `/api/robots/${enc(id)}${child === undefined ? '' : `/subagents/${enc(child)}`}/events?limit=${page.limit}${page.before === undefined ? '' : `&before=${page.before}`}${page.after === undefined ? '' : `&after=${page.after}`}`),
    /** A Robot's Subagents, each with its own Chat and Trajectory (ao-ce55). */
    subagents: (id: string) => get(Schema.Array(SubagentView), `/api/robots/${enc(id)}/subagents`),
    subagentConversation: (id: string, child: string) => get(Conversation, `/api/robots/${enc(id)}/subagents/${enc(child)}/conversation`),
    interruptSubagent: (id: string, child: string) => send('POST', `/api/robots/${enc(id)}/subagents/${enc(child)}/interrupt`),
    panel: (id: string) => get(RobotPanel, `/api/robots/${enc(id)}/panel`),
    catalog: (id: string) => get(SettingsCatalog, `/api/robots/${enc(id)}/catalog`),
    webhook: (id: string) => get(WebhookView, `/api/robots/${enc(id)}/webhook`),
    regenerateWebhook: (id: string) => request(WebhookView, 'POST', `/api/robots/${enc(id)}/webhook/regenerate`, {}),
    prompt: (id: string) => get(PromptPreview, `/api/robots/${enc(id)}/prompt`),
    memberCosts: get(MemberCosts, '/api/me/costs'),
    send: (id: string, message: SendMessage) => send('POST', `/api/robots/${enc(id)}/messages`, message),
    retry: (id: string) => request(RetryResult, 'POST', `/api/robots/${enc(id)}/retry`, {}),
    updateSettings: (id: string, patch: SettingsPatch) => request(RobotSettings, 'PATCH', `/api/robots/${enc(id)}/settings`, patch),
    answer: (id: string, proposal: ProposalView, approve: boolean, approved?: readonly string[], scope?: string, note?: string) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}`, { revision: proposal.revision, approve, ...(approved === undefined ? {} : { approved }), ...(scope === undefined ? {} : { scope }), ...(note === undefined ? {} : { note }) }),
    /** A question Ask: an option by value, the owner's own words, or a dismissal (v1.15). */
    choose: (id: string, proposal: ProposalView, choice: { readonly value?: string; readonly values?: readonly string[]; readonly text?: string; readonly dismiss?: true }) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}`, { revision: proposal.revision, approve: choice.dismiss !== true, ...(choice.value === undefined ? {} : { value: choice.value }), ...(choice.values === undefined ? {} : { values: choice.values }), ...(choice.text === undefined ? {} : { text: choice.text }) }),
    /** The owner's edit of a draft before Send (v1.17): the Ask comes back at its new revision. */
    editDraft: (id: string, proposal: ProposalView, edit: { readonly body: string; readonly subject?: string }) => request(ProposalView, 'PATCH', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}/draft`, { revision: proposal.revision, ...edit }),
    /** "Always allow this" on a tool-call Ask (v1.17): the items go to allow for the Robot and the call runs. */
    alwaysAllow: (id: string, proposal: ProposalView) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}/always-allow`, { revision: proposal.revision }),
    /** A credential Ask saved: the form's password goes to the Home through this call (v1.15). */
    saveCredential: (id: string, proposal: ProposalView, entry: Omit<CredentialSave, 'revision'>) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/proposals/${enc(proposal.id)}/credential`, { revision: proposal.revision, ...entry }),
    answerHelp: (id: string, proposal: ProposalView, text: string) => request(ProposalView, 'POST', `/api/robots/${enc(id)}/help/${enc(proposal.id)}`, { text }),
    pause: (id: string) => send('POST', `/api/robots/${enc(id)}/pause`),
    resume: (id: string) => send('POST', `/api/robots/${enc(id)}/resume`),
    remove: (id: string, confirm: string) => send('DELETE', `/api/robots/${enc(id)}`, { confirm }),
    clearHistory: (id: string, confirm: string) => send('POST', `/api/robots/${enc(id)}/clear`, { confirm }),
    startOver: (id: string, confirm: string) => send('POST', `/api/robots/${enc(id)}/start-over`, { confirm }),
    listPref: (id: string, change: ListPrefPatch) => send('POST', `/api/robots/${enc(id)}/list`, change),
    /** The person's own sidebar groups (ux-wxbm). */
    robotGroups: get(Schema.Array(RobotGroup), '/api/robot-groups'),
    createGroup: (name: string) => request(RobotGroup, 'POST', '/api/robot-groups', { name }),
    updateGroup: (id: string, patch: GroupPatch) => request(RobotGroup, 'PATCH', `/api/robot-groups/${enc(id)}`, patch),
    orderGroups: (ids: readonly string[]) => request(Schema.Array(RobotGroup), 'PUT', '/api/robot-groups/order', { ids }),
    deleteGroup: (id: string) => send('DELETE', `/api/robot-groups/${enc(id)}`),
    /** One page of Mission Control (v1.13 ticket 06), by query ("scope=home&state=open&fleetPage=2"). */
    mission: (query: string) => get(MissionView, `/api/mission?${query}`),
    /** The active Members of the Home, for a Task's doer (v1.13). */
    homeMembers: get(Schema.Array(MemberView), '/api/members'),
    /** Tasks (v1.13): a page by query ("state=all&parent=t-…"), one Task, and its changes. */
    tasks: (query: string) => get(TaskPage, `/api/tasks${query === '' ? '' : `?${query}`}`),
    task: (id: string) => get(TaskView, `/api/tasks/${enc(id)}`),
    createTask: (input: TaskInput) => request(TaskView, 'POST', '/api/tasks', input),
    updateTask: (id: string, patch: TaskPatch) => request(TaskView, 'PATCH', `/api/tasks/${enc(id)}`, patch),
    finishTask: (id: string) => request(TaskView, 'POST', `/api/tasks/${enc(id)}/done`, {}),
    cancelTask: (id: string) => request(TaskView, 'POST', `/api/tasks/${enc(id)}/cancel`, {}),
    pauseTask: (id: string, paused: boolean) => request(TaskView, 'POST', `/api/tasks/${enc(id)}/pause`, { paused }),
    runTask: (id: string) => request(TaskView, 'POST', `/api/tasks/${enc(id)}/run`, {}),
    /** Stop the Robot's running Turn (mc-w5ee). */
    interrupt: (robotId: string) => send('POST', `/api/robots/${enc(robotId)}/interrupt`),
    stopBox: (robotId: string) => send('POST', `/api/robots/${enc(robotId)}/box/stop`),
    stopBoxJob: (robotId: string, jobId: string) => send('POST', `/api/robots/${enc(robotId)}/box/jobs/${enc(jobId)}/stop`),
    assignTask: (id: string, assignee: TaskAssignee) => request(TaskView, 'POST', `/api/tasks/${enc(id)}/assign`, { assignee }),
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
    addAccount: (provider: string, key: string, shared: boolean, label?: string) => send('POST', `/api/providers/${enc(provider)}/accounts`, label === undefined ? { key, shared } : { key, shared, label }),
    startOAuth: (provider: string) => request(OAuthStart, 'POST', `/api/providers/${enc(provider)}/oauth/start`, {}),
    finishOAuth: (provider: string, shared: boolean, pasted?: string) => request(OAuthFinished, 'POST', `/api/providers/${enc(provider)}/oauth/finish`, pasted === undefined ? { shared } : { shared, pasted }),
    updateAccount: (id: string, change: { label?: string; shared?: boolean }) => send('PATCH', `/api/accounts/${enc(id)}`, change),
    removeAccount: (id: string) => send('DELETE', `/api/accounts/${enc(id)}`),
    accountUsage: (id: string, owner: string) => request(AccountUsage, 'GET', `/api/accounts/${enc(id)}/usage?owner=${enc(owner)}`),
    checkAccount: (id: string) => send('POST', `/api/accounts/${enc(id)}/check`, {}),

    admin: get(AdminView, '/api/admin'),
    homeSettings: get(HomeSettingsView, '/api/admin/settings'),
    updateHomeSettings: (patch: HomeSettingsPatch) => request(HomeSettingsSaved, 'PATCH', '/api/admin/settings', patch),
    setSkillRepository: (input: { readonly repo: string; readonly ref: string; readonly path: string; readonly token?: string }) => send('PUT', '/api/admin/skills/repository', input),
    homeMemory: get(TextContent, '/api/home-memory'),
    setHomeMemory: (content: string) => send('PUT', '/api/admin/home-memory', { content }),
    setExaKey: (key: string | null) => request(ConfiguredResult, 'PUT', '/api/admin/exa', { key }),
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

    plugins: get(Schema.Array(PluginView), '/api/plugins'),
    setPluginEnabled: (name: string, enabled: boolean) => send('PUT', `/api/admin/plugins/${enc(name)}`, { enabled }),
    savePluginSettings: (name: string, values: Record<string, unknown>) => request(PluginView, 'PUT', `/api/admin/plugins/${enc(name)}/settings`, { values }),
    connections: get(Schema.Array(ConnectionView), '/api/connections'),
    pasteConnection: (kind: string, input: { readonly label?: string; readonly shared: boolean; readonly values: Record<string, string> }) => request(ConnectionView, 'POST', `/api/connections/${enc(kind)}`, input),
    updateConnection: (id: string, change: { readonly label?: string; readonly shared?: boolean; readonly isDefault?: boolean; readonly instructions?: string }) => request(ConnectionView, 'PATCH', `/api/connections/${enc(id)}`, change),
    removeConnection: (id: string) => send('DELETE', `/api/connections/${enc(id)}`),
    connectionNotes: get(Schema.Array(ConnectionNote), '/api/connections/notes'),
    dismissConnectionNote: (id: string) => send('DELETE', `/api/connections/notes/${enc(id)}`),
    /** Connect as you through Mr. Robot's browser (v1.12 ticket 11): open the sign-in page, follow it, end it. */
    startSessionCapture: (kind: string) => request(SessionCaptureStarted, 'POST', `/api/connections/${enc(kind)}/browser-start`, {}),
    sessionCapture: (kind: string) => get(SessionCapture, `/api/connections/${enc(kind)}/browser`),
    endSessionCapture: (kind: string) => request(SessionCapture, 'POST', `/api/connections/${enc(kind)}/browser-end`, {}),
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
