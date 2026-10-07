/**
 * The Host protocol (v1.2, hs-xax9): what Mr. Robot asks a Host (a computer running the Mr. Robot
 * app) and what the Host reports, as Effect RPC schemas shared by the app and the Worker. One
 * WebSocket per Host carries text frames: {"t":"rpc","d":<RPC message>} for calls (the Member DO
 * is the RPC client, the app the server) and {"t":"hb","d":<Heartbeat>} for heartbeats.
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcClient from 'effect/rpc/RpcClient'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'

/** A host-side failure: an OS error (code like ENOENT, EACCES), a timeout, or a missing capability. */
export class HostError extends Schema.TaggedError<HostError>()('HostError', {
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

/** Read a file the signed-in user can reach; text when it is UTF-8, else base64. */
export const Read = Rpc.make('Read', {
  payload: { path: Schema.String },
  success: Schema.Struct({ path: Schema.String, size: Schema.Number, text: Schema.NullOr(Schema.String), base64: Schema.NullOr(Schema.String) }),
  error: HostError,
})

/** Write a file (creating its directories); text or base64. */
export const Write = Rpc.make('Write', {
  payload: { path: Schema.String, text: Schema.optional(Schema.String), base64: Schema.optional(Schema.String) },
  success: Schema.Struct({ path: Schema.String, bytes: Schema.Number }),
  error: HostError,
})

/** Run a shell command as the signed-in user, in their login shell and environment (hs-i785). */
export const Run = Rpc.make('Run', {
  payload: { command: Schema.String, cwd: Schema.optional(Schema.String), timeoutMs: Schema.optional(Schema.Number) },
  success: Schema.Struct({ stdout: Schema.String, stderr: Schema.String, exitCode: Schema.NullOr(Schema.Number), timedOut: Schema.Boolean }),
  error: HostError,
})

/** Start (if needed) the host's Chrome and connect its DevTools to the relay socket at relayUrl. */
export const BrowserOpen = Rpc.make('BrowserOpen', {
  payload: { session: Schema.String, relayUrl: Schema.String },
  success: Schema.Struct({ browser: Schema.String }),
  error: HostError,
})

export const BrowserClose = Rpc.make('BrowserClose', {
  payload: { session: Schema.String },
  error: HostError,
})

export class HostRpcs extends RpcGroup.make(Read, Write, Run, BrowserOpen, BrowserClose) {}

/** What a Host reports every few seconds while connected (hs-7dlt). */
export const Heartbeat = Schema.Struct({
  version: Schema.String,
  platform: Schema.String,
  hostname: Schema.String,
  capabilities: Schema.Struct({
    /** A graphical session the host browser can open a window in. */
    graphical: Schema.Boolean,
    /** The Chrome or Chromium the host browser uses, or null when none was found. */
    chrome: Schema.NullOr(Schema.String),
  }),
})
export type Heartbeat = typeof Heartbeat.Type

/** How often a Host sends a heartbeat, and after how long without one it counts as offline. */
export const HEARTBEAT_MS = 15_000
export const OFFLINE_AFTER_MS = 45_000

export type Frame = { readonly t: 'rpc'; readonly d: string } | { readonly t: 'hb'; readonly d: Heartbeat }

export function frame(value: Frame): string {
  return JSON.stringify(value)
}

export function parseFrame(text: string): Frame | undefined {
  try {
    const value = JSON.parse(text) as Frame
    return value.t === 'rpc' || value.t === 'hb' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The client side over a socket the caller owns (the Member DO's hibernatable WebSocket): requests
 * go out through send; the caller hands every incoming RPC frame to deliver.
 */
export function makeHostClient(send: (text: string) => void) {
  const serialization = RpcSerialization.json
  const parser = serialization.makeUnsafe()
  let write: ((response: unknown) => Effect.Effect<void>) | undefined
  const protocol = RpcClient.Protocol.make(Effect.fnUntraced(function* (writeResponse) {
    write = (response) => writeResponse(0, response as never)
    return {
      send: (_clientId: number, request: unknown) => Effect.sync(() => {
        const encoded = parser.encode(request)
        if (encoded !== undefined) send(frame({ t: 'rpc', d: typeof encoded === 'string' ? encoded : String.fromCharCode(...encoded) }))
      }),
      supportsAck: false,
      supportsTransferables: false,
      codecFor: serialization.codecFor,
    }
  }))
  const client = RpcClient.make(HostRpcs).pipe(Effect.provide(Layer.effect(RpcClient.Protocol, protocol)))
  return {
    client,
    /** A frame's RPC payload from the host. */
    deliver: (data: string): Effect.Effect<void> => Effect.suspend(() => {
      if (write === undefined) return Effect.void
      const writer = write
      return Effect.forEach(parser.decode(data), (response) => writer(response), { discard: true })
    }),
  }
}

/**
 * The server side (the Host app, and the fake host in tests): handlers answer requests that arrive
 * through onRequest; responses leave through send.
 */
export function serveHost<R>(handlers: Layer.Layer<Rpc.ToHandler<Rpc.Any>, never, R>, send: (text: string) => void) {
  const serialization = RpcSerialization.json
  const parser = serialization.makeUnsafe()
  // Messages that arrive before the server has started wait here.
  const queue = Effect.runSync(Queue.unbounded<unknown>())
  const protocol = RpcServer.Protocol.make(Effect.fnUntraced(function* (writeRequest) {
    yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(queue), (message) => writeRequest(0, message as never))))
    return {
      disconnects: yield* Queue.make<number>(),
      send: (_clientId: number, response: unknown) => Effect.sync(() => {
        const encoded = parser.encode(response)
        if (encoded !== undefined) send(frame({ t: 'rpc', d: typeof encoded === 'string' ? encoded : String.fromCharCode(...encoded) }))
      }),
      end: () => Effect.void,
      clientIds: Effect.succeed(new Set([0])),
      initialMessage: Effect.succeedNone,
      supportsAck: false,
      supportsTransferables: false,
      supportsSpanPropagation: false,
      supportsNotifications: false,
      codecFor: serialization.codecFor,
    }
  }))
  const server = RpcServer.make(HostRpcs).pipe(Effect.provide(handlers as never), Effect.provide(Layer.effect(RpcServer.Protocol, protocol)))
  return {
    server: server as Effect.Effect<never, never, R>,
    deliver: (data: string) => Effect.suspend(() => Effect.forEach(parser.decode(data), (message) => Queue.offer(queue, message), { discard: true })),
  }
}
