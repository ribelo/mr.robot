/**
 * The connector core (v1.5 ticket 01): a connector plugin turns a Robot's granted connections of one
 * kind into tools. Every tool names the account it acts on (cn-f6ux), takes an account parameter when
 * more than one is granted (cn-bsge), resolves the account's secrets at each call (cn-a1i0), and
 * labels its result with account and action for the trajectory (cn-07jo). Write tools exist only
 * when a connection carries the write grant (cn-z1di, cn-aljt).
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ConnectionStatus, ConnectorKind } from '@mr-robot/protocol'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import { tool } from '../agent/tools/define.ts'
import type { ConnectionMeta } from '../member/connections.ts'

/** A connection granted to this Robot, as its tools see it; no secrets. */
export interface GrantedConnection {
  readonly id: string
  readonly kind: ConnectorKind
  readonly label: string
  readonly account: string
  readonly services: readonly string[]
  /** The write grant: Gmail send, Slack post. */
  readonly write: boolean
  readonly isDefault: boolean
}

/** One use of a connection: its secrets (fresh from the owner's vault) and connector state. */
export interface ConnectionUse {
  readonly secrets: Readonly<Record<string, string>>
  readonly meta: ConnectionMeta
}

export interface ConnectorHost {
  readonly kind: ConnectorKind
  /** Granted connections of this kind. */
  readonly accounts: readonly GrantedConnection[]
  /** Secrets and state of one granted connection, resolved now. */
  use(connectionId: string): Promise<ConnectionUse>
  /** The service rejected the connection's credentials: show it on the person's row. */
  markStatus(connectionId: string, status: ConnectionStatus, note: string): Promise<void>
  /** fetch for the connector's HTTP (tests substitute recorded responses). */
  readonly fetch: typeof globalThis.fetch
  /** Write a file into the Robot's Workspace (attachments, downloads); returns its path. */
  saveFile(path: string, bytes: Uint8Array): Promise<string>
  /** Read a Workspace file (uploads, attachments to send). */
  readFile(path: string): Promise<Uint8Array>
}

/** What a pasted connection turns out to be once checked with the service. */
export interface VerifiedConnection {
  /** The account it acts as (an e-mail, a workspace, a bot name). */
  readonly account: string
  /** A default label. */
  readonly label: string
  readonly meta: ConnectionMeta
}

export interface ConnectorPlugin {
  readonly kind: ConnectorKind
  /** Check pasted secrets with the service before they are stored (paste connectors). */
  verifyPasted?(secrets: Readonly<Record<string, string>>, fetch: typeof globalThis.fetch): Effect.Effect<VerifiedConnection, ConnectorFailure>
  tools(host: ConnectorHost): ToolDefinition[]
  /** Standing rules for the model when the connector is mounted. */
  prompt?(host: ConnectorHost): string
}

// ------------------------------------------------------------------ failures

/** The credentials were refused (401, revoked token, logged-out session). */
export class ConnectorUnauthorized extends Data.TaggedError('ConnectorUnauthorized')<{ readonly message: string }> {}
/** The service answered with an error. */
export class ConnectorRequestFailed extends Data.TaggedError('ConnectorRequestFailed')<{ readonly status: number; readonly message: string }> {}
/** The service did not answer. */
export class ConnectorUnreachable extends Data.TaggedError('ConnectorUnreachable')<{ readonly message: string; readonly cause?: unknown }> {}
/** The answer does not match the expected shape. */
export class ConnectorResponseInvalid extends Data.TaggedError('ConnectorResponseInvalid')<{ readonly message: string }> {}
/** Too many requests, still after retrying. */
export class ConnectorRateLimited extends Data.TaggedError('ConnectorRateLimited')<{ readonly retryAfterSeconds: number }> {}
/** The tool was asked for something it cannot do (unknown account, missing argument, missing grant). */
export class ConnectorRefused extends Data.TaggedError('ConnectorRefused')<{ readonly message: string }> {}

export type ConnectorFailure = ConnectorUnauthorized | ConnectorRequestFailed | ConnectorUnreachable | ConnectorResponseInvalid | ConnectorRateLimited | ConnectorRefused

export function describeConnectorFailure(failure: ConnectorFailure): string {
  switch (failure._tag) {
    case 'ConnectorUnauthorized': return `the account's credentials were refused: ${failure.message}`
    case 'ConnectorRequestFailed': return `the service answered ${failure.status}: ${failure.message}`
    case 'ConnectorUnreachable': return `the service could not be reached: ${failure.message}`
    case 'ConnectorResponseInvalid': return `the service sent an answer in an unexpected shape: ${failure.message}`
    case 'ConnectorRateLimited': return `the service is rate-limiting; try again in ${failure.retryAfterSeconds} s`
    case 'ConnectorRefused': return failure.message
  }
}

// ------------------------------------------------------------------ HTTP

export interface HttpCall {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  /** JSON body. */
  readonly json?: unknown
  /** Form body (application/x-www-form-urlencoded). */
  readonly form?: Readonly<Record<string, string>>
  /** Raw body with its content type. */
  readonly bytes?: { readonly data: Uint8Array; readonly contentType: string }
}

/** How a service says "your credentials are no good" when the HTTP status does not (Slack answers 200 with ok:false). */
export type UnauthorizedTest = (status: number, body: unknown) => string | null

const RETRY_LIMIT = 2

/**
 * One request through Effect HttpClient: the body decoded with schema; 401/403 become
 * ConnectorUnauthorized, 429 is retried after Retry-After (at most twice), other errors carry the status.
 */
export function request<S extends Schema.Top>(fetch: typeof globalThis.fetch, call: HttpCall, schema: S, unauthorized?: UnauthorizedTest): Effect.Effect<S['Type'], ConnectorFailure> {
  const once = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    let req = HttpClientRequest.make(call.method)(call.url)
    for (const [name, value] of Object.entries(call.headers ?? {})) req = HttpClientRequest.setHeader(req, name, value)
    if (call.json !== undefined) req = HttpClientRequest.bodyJsonUnsafe(req, call.json)
    else if (call.form !== undefined) req = HttpClientRequest.bodyUrlParams(req, call.form)
    else if (call.bytes !== undefined) req = HttpClientRequest.bodyUint8Array(req, call.bytes.data, call.bytes.contentType)
    const response = yield* client.execute(req).pipe(Effect.mapError((cause) => new ConnectorUnreachable({ message: String(cause), cause })))
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ''))
    let body: unknown = text
    try { body = text === '' ? null : JSON.parse(text) } catch { /* not JSON: keep the text */ }
    if (response.status === 429) {
      const retryAfter = Number(response.headers['retry-after'] ?? '1')
      return yield* new ConnectorRateLimited({ retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 1 })
    }
    const refused = unauthorized?.(response.status, body) ?? null
    if (refused !== null || response.status === 401) return yield* new ConnectorUnauthorized({ message: refused ?? errorText(body, response.status) })
    if (response.status < 200 || response.status >= 300) return yield* new ConnectorRequestFailed({ status: response.status, message: errorText(body, response.status) })
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError((issue) => new ConnectorResponseInvalid({ message: String(issue).slice(0, 300) })))
  })
  return once.pipe(
    Effect.retry({
      while: (failure: ConnectorFailure) => failure._tag === 'ConnectorRateLimited' && failure.retryAfterSeconds <= 30,
      times: RETRY_LIMIT,
      schedule: Schedule.spaced(Duration.seconds(1)),
    }),
    Effect.provide(httpLayer(fetch)),
  ) as Effect.Effect<S['Type'], ConnectorFailure>
}

/** Raw bytes of a response (attachments, downloads). */
export function requestBytes(fetch: typeof globalThis.fetch, call: HttpCall): Effect.Effect<{ readonly bytes: Uint8Array; readonly contentType: string }, ConnectorFailure> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    let req = HttpClientRequest.make(call.method)(call.url)
    for (const [name, value] of Object.entries(call.headers ?? {})) req = HttpClientRequest.setHeader(req, name, value)
    const response = yield* client.execute(req).pipe(Effect.mapError((cause) => new ConnectorUnreachable({ message: String(cause), cause })))
    if (response.status === 401) return yield* new ConnectorUnauthorized({ message: 'download refused' })
    if (response.status < 200 || response.status >= 300) return yield* new ConnectorRequestFailed({ status: response.status, message: yield* response.text.pipe(Effect.orElseSucceed(() => '')) })
    const buffer = yield* response.arrayBuffer.pipe(Effect.mapError((cause) => new ConnectorUnreachable({ message: String(cause), cause })))
    return { bytes: new Uint8Array(buffer), contentType: response.headers['content-type'] ?? 'application/octet-stream' }
  }).pipe(Effect.provide(httpLayer(fetch)))
}

function httpLayer(fetch: typeof globalThis.fetch): Layer.Layer<HttpClient.HttpClient> {
  // SAFETY: the arrow has fetch's call signature; the cast only adds fetch's static members, which HttpClient never uses.
  const late = ((input, init) => fetch(input, init)) as typeof globalThis.fetch
  return FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, late)))
}

function errorText(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>
    const error = record['error']
    if (typeof error === 'string') return error
    if (error !== null && typeof error === 'object' && typeof (error as Record<string, unknown>)['message'] === 'string') return (error as Record<string, string>)['message']!
    if (typeof record['message'] === 'string') return record['message']
  }
  return typeof body === 'string' && body !== '' ? body.slice(0, 300) : `HTTP ${status}`
}

// ------------------------------------------------------------------ accounts and tools

/** The account a call acts on: the one named, the only one, or the default. */
export function pickAccount(accounts: readonly GrantedConnection[], requested: string | undefined, write: boolean): GrantedConnection | ConnectorRefused {
  const usable = write ? accounts.filter((account) => account.write) : accounts
  const names = usable.map((account) => `"${account.label}" (${account.account})`).join(', ')
  if (usable.length === 0) return new ConnectorRefused({ message: write ? 'No granted account allows this: the owner grants writing separately.' : 'No account is granted.' })
  if (requested === undefined || requested.trim() === '') {
    if (usable.length === 1) return usable[0]!
    const fallback = usable.find((account) => account.isDefault)
    return fallback ?? new ConnectorRefused({ message: `Several accounts are granted; name one with account: ${names}.` })
  }
  const wanted = requested.trim().toLowerCase()
  return usable.find((account) => account.label.toLowerCase() === wanted || account.account.toLowerCase() === wanted || account.id === requested)
    ?? new ConnectorRefused({ message: `No granted account "${requested}"${write ? ' with the write grant' : ''}. Granted: ${names}.` })
}

export interface ConnectorToolSpec<A> {
  readonly name: string
  readonly description: string
  /** JSON Schema properties and required names, without the account parameter. */
  readonly parameters: { readonly properties: Record<string, unknown>; readonly required?: readonly string[] }
  /** A write tool (send, post): offered only when an account has the write grant. */
  readonly write?: boolean
  /** Which service of the account the tool needs (Google: gmail, calendar, …). */
  readonly service?: string
  /** One line naming what the call did, for the result header and the trajectory. */
  readonly action: (args: A) => string
  readonly run: (args: A, use: ConnectionUse, account: GrantedConnection) => Effect.Effect<unknown, ConnectorFailure>
}

/** Accounts a tool may act on: the service it needs, and the write grant for write tools. */
function eligible(host: ConnectorHost, spec: { readonly write?: boolean; readonly service?: string }): GrantedConnection[] {
  return host.accounts.filter((account) => (spec.service === undefined || account.services.length === 0 || account.services.includes(spec.service)) && (spec.write !== true || account.write))
}

/** A connector tool: account routing, fresh secrets, the account/action header, failures as readable results. */
export function connectorTool<A extends Record<string, unknown>>(host: ConnectorHost, spec: ConnectorToolSpec<A>): ToolDefinition | undefined {
  const accounts = eligible(host, spec)
  if (accounts.length === 0) return undefined
  const several = accounts.length > 1
  const properties = several
    ? { account: { type: 'string', enum: accounts.map((account) => account.label), description: `Which account to act on: ${accounts.map((account) => `${account.label} = ${account.account}${account.isDefault ? ' (default)' : ''}`).join('; ')}.` }, ...spec.parameters.properties }
    : spec.parameters.properties
  const only = accounts[0]!
  return tool<A & { account?: string }>({
    name: spec.name,
    description: `${spec.description}${several ? '' : ` Acts on ${only.label} (${only.account}).`}`,
    parameters: { properties, ...(spec.parameters.required === undefined ? {} : { required: [...spec.parameters.required] }) } as never,
    execute: async (args) => {
      const picked = pickAccount(accounts, args.account, false)
      if (picked instanceof ConnectorRefused) return `Not done: ${picked.message}`
      const header = `[${host.kind} · ${picked.label} (${picked.account})] ${spec.action(args)}`
      const use = await host.use(picked.id)
      const outcome = await Effect.runPromise(Effect.result(spec.run(args, use, picked)))
      if (outcome._tag === 'Success') return `${header}\n${typeof outcome.success === 'string' ? outcome.success : JSON.stringify(outcome.success, null, 2)}`
      const failure = outcome.failure
      if (failure._tag === 'ConnectorUnauthorized') await host.markStatus(picked.id, host.kind === 'google' ? 'needs-reconsent' : 'rejected', failure.message).catch(() => undefined)
      return `${header}\nFailed: ${describeConnectorFailure(failure)}${failure._tag === 'ConnectorUnauthorized' ? ' The owner sees this on the connection\'s row and can reconnect it there.' : ''}`
    },
  })
}

/** The tools of the specs that have an eligible account. */
export function connectorTools(host: ConnectorHost, specs: ReadonlyArray<ConnectorToolSpec<never>>): ToolDefinition[] {
  return specs.flatMap((spec) => connectorTool(host, spec as unknown as ConnectorToolSpec<Record<string, unknown>>) ?? [])
}

/** A tool listing the granted accounts of a connector, so the model knows what it can act on. */
export function accountsTool(host: ConnectorHost): ToolDefinition {
  return tool<Record<string, never>>({
    name: `${host.kind}_accounts`,
    description: `List the ${host.kind} accounts granted to you: label, account, services, whether writing is granted, and the default.`,
    parameters: { properties: {} },
    execute: async () => host.accounts.map(({ label, account, services, write, isDefault }) => ({ label, account, services, write, isDefault })),
  })
}
