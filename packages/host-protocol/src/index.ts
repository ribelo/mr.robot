/**
 * The Host protocol (v1.2, hs-xax9): what Mr. Robot asks a Host (a computer running the Mr. Robot
 * app) and what the Host reports, as Effect RPC schemas shared by the app and the Worker. One
 * WebSocket per Host carries text frames: {"t":"rpc","d":<RPC message>} for calls (the Member DO
 * is the RPC client, the app the server), {"t":"hb","d":<Heartbeat>} for heartbeats and {"t":"job","d":<JobEnded>} when a job on the
 * Host ends.
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcClient from 'effect/rpc/RpcClient'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'

export * from './copy-engine.ts'
export * from './session-sign-in.ts'
export * from './file-search.ts'

/** A host-side failure: an OS error (code like ENOENT, EACCES), a timeout, or a missing capability. */
export class HostError extends Schema.TaggedError<HostError>()('HostError', {
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

/**
 * What a Robot may do on a Host (v1.16 ticket 02, ob-wh59): the mode and the write roots of the grant the call runs under, and the
 * name of the Robot's own directory (~/mr-robot/<robot>/ on the Host). The Worker fills it from the grant; the Robot never chooses it.
 * Reads are as wide as the OS user in every mode; the mode limits what a command or a file write changes.
 */
export const HostMode = Schema.Literals(['read-only', 'workspace-write', 'full'])
export type HostMode = typeof HostMode.Type

export const HostAccess = Schema.Struct({
  /** The name of the Robot's directory under mr-robot/ in the OS user's home: its default cwd and a write root, created on first use. */
  robot: Schema.String,
  mode: HostMode,
  /** More directories the Robot may write in workspace-write mode (absolute, or ~/ for the home directory). */
  roots: Schema.Array(Schema.String),
})
export type HostAccess = typeof HostAccess.Type

/** The longest a run waits for its command before the command goes on as a job: the tool's limit, which the Host app and the Worker both honour. */
export const RUN_MAX_WAIT_SECONDS = 1800

/** The code of the HostError a write outside the mode and roots fails with. */
export const SANDBOX_DENIED = 'SANDBOX_DENIED'
/** The code of the HostError a confined command fails with when this computer has no sandbox that can confine it (it fails closed). */
export const SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'

/** Read a file the signed-in user can reach; text when it is UTF-8, else base64. A relative path is relative to the Robot's directory. */
export const Read = Rpc.make('Read', {
  payload: { path: Schema.String, access: HostAccess },
  success: Schema.Struct({ path: Schema.String, size: Schema.Number, text: Schema.NullOr(Schema.String), base64: Schema.NullOr(Schema.String) }),
  error: HostError,
})

/** Write a file (creating its directories); text or base64. */
export const Write = Rpc.make('Write', {
  payload: { path: Schema.String, text: Schema.optional(Schema.String), base64: Schema.optional(Schema.String), access: HostAccess },
  success: Schema.Struct({ path: Schema.String, bytes: Schema.Number }),
  error: HostError,
})

/**
 * Copy (v1.16 ticket 06): a file moves between the Host app and R2 through presigned URLs the Worker minted; the Worker and the Member
 * Durable Object only coordinate. The app first reports the size of the file, so that the Worker can plan the parts.
 */
export const CopyStat = Rpc.make('CopyStat', {
  payload: { path: Schema.String, access: HostAccess },
  success: Schema.Struct({ path: Schema.String, size: Schema.Number }),
  error: HostError,
})

/** One part of an upload: the bytes from `offset` for `length`, put to `url`. A file that fits in one part is one PUT; a larger one is a multipart upload. */
export const UploadPart = Schema.Struct({ number: Schema.Number, url: Schema.String, offset: Schema.Number, length: Schema.Number })
export type UploadPart = typeof UploadPart.Type

/** Put a file to R2 part by part, each part retried; the ETag of each part comes back for the Worker to complete the upload. */
export const Upload = Rpc.make('Upload', {
  payload: { path: Schema.String, size: Schema.Number, parts: Schema.Array(UploadPart), access: HostAccess },
  success: Schema.Struct({ path: Schema.String, size: Schema.Number, etags: Schema.Array(Schema.Struct({ number: Schema.Number, etag: Schema.String })) }),
  error: HostError,
})

/**
 * Fetch bytes `from` to `until` of an object of `size` bytes from R2, in ranges of `partBytes`, into a file (creating its directories). A large
 * object comes in windows (the Worker sends one part per call), each with a fresh link; the file appears only when a window reaches the end
 * and all of it arrived. Until then the bytes are in a part file beside the file, one per copy (deep review P12): the windows of one copy
 * name the same `copy`, and a window with `from` above 0 continues that copy's part file or fails when the app no longer has it.
 */
export const Download = Rpc.make('Download', {
  payload: { copy: Schema.String, path: Schema.String, url: Schema.String, size: Schema.Number, partBytes: Schema.Number, from: Schema.Number, until: Schema.Number, access: HostAccess },
  success: Schema.Struct({ path: Schema.String, bytes: Schema.Number }),
  error: HostError,
})

/**
 * List the files that match a glob, as the Host prints them (SKIPPED_DIRECTORIES left out); relative paths start in the Robot's directory.
 * `truncated`: the walk stopped at LISTING_MAX_FILES files, so some matches may be missing.
 */
export const Glob = Rpc.make('Glob', {
  payload: { pattern: Schema.String, access: HostAccess },
  success: Schema.Struct({ paths: Schema.Array(Schema.String), truncated: Schema.Boolean }),
  error: HostError,
})

/**
 * Search the text files under a directory with a JavaScript regular expression (the Robot's directory when no path is given).
 * `truncated`: there were more than GREP_MAX_MATCHES matches, or the walk stopped at LISTING_MAX_FILES files.
 */
export const Grep = Rpc.make('Grep', {
  payload: { pattern: Schema.String, ignoreCase: Schema.Boolean, glob: Schema.optional(Schema.String), path: Schema.optional(Schema.String), access: HostAccess },
  success: Schema.Struct({ matches: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.Number, text: Schema.String })), truncated: Schema.Boolean }),
  error: HostError,
})

/** Delete one file; a write, so it obeys the mode and the roots. */
export const Delete = Rpc.make('Delete', {
  payload: { path: Schema.String, access: HostAccess },
  success: Schema.Struct({ path: Schema.String }),
  error: HostError,
})

/** What a command left on one output stream: the end of it (the Host keeps the rest in a file of its own), and whether it was cut. */
export const CollectedOutput = Schema.Struct({ text: Schema.String, truncated: Schema.Boolean, spillPath: Schema.optional(Schema.String) })
export type CollectedOutput = typeof CollectedOutput.Type

/** What the sandbox did to a command (DSH's ShellSandboxInfo): the mode it ran under, whether a file effect was denied (and where), and how completely it was enforced. */
export const SandboxReport = Schema.Struct({
  mode: HostMode,
  denied: Schema.Boolean,
  /** The path of the denied file effect, when the Host could read it from the command's error output. */
  deniedPath: Schema.optional(Schema.String),
  enforcement: Schema.optional(Schema.Literals(['full', 'partial'])),
})
export type SandboxReport = typeof SandboxReport.Type

/** The facts a command's answer carries whatever its shape: where it ran and how long the call waited. */
const OutcomeFacts = {
  cwd: Schema.String,
  timeoutMs: Schema.Number,
}

/** The command ended within the time the call gave it. */
export const ForegroundOutcome = Schema.Struct({
  kind: Schema.Literal('foreground'),
  ...OutcomeFacts,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  timedOut: Schema.Boolean,
  aborted: Schema.Boolean,
  stdout: CollectedOutput,
  stderr: CollectedOutput,
  /** What the sandbox did; known once the command has ended, so only this shape carries it. */
  sandbox: Schema.optional(SandboxReport),
})

/** The command was still running when the time was up, so it goes on as a job; `output` is what it printed so far. */
export const PromotedOutcome = Schema.Struct({ kind: Schema.Literal('promoted'), ...OutcomeFacts, jobId: Schema.String, output: Schema.String })

/** The call asked for a job, and the command was started as one. */
export const BackgroundOutcome = Schema.Struct({ kind: Schema.Literal('background'), ...OutcomeFacts, jobId: Schema.String })

/**
 * Run a command through DSH's shell and sandbox (v1.16 tickets 02 and 03, ob-wsf7, ob-sja4): bash with bwrap or Landlock on Linux and
 * Seatbelt on macOS, as the signed-in user, in the Robot's directory unless told otherwise. Every command is a job of DSH's jobs-local
 * registry, and the answer has DSH's three shapes: it ended in time (foreground), it was still running at the limit (promoted: the job
 * goes on) or it was started as a job at once (background).
 */
export const RunOutcome = Schema.Union([ForegroundOutcome, PromotedOutcome, BackgroundOutcome])
export type RunOutcome = typeof RunOutcome.Type

export const Run = Rpc.make('Run', {
  payload: {
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
    /** How long the call waits for the command to end before it goes on as a job; the command itself has no limit. */
    timeoutMs: Schema.optional(Schema.Number),
    /** Start the command as a job and answer at once. */
    background: Schema.Boolean,
    /** The name the Worker gives the job, which the other job calls and the job frame use. */
    job: Schema.String,
    access: HostAccess,
  },
  success: RunOutcome,
  error: HostError,
})

/** The code of the HostError a job call fails with when the app has no such job (it was never started here, or the app restarted). */
export const NO_SUCH_JOB = 'NO_SUCH_JOB'

/** How a job stands. Like DSH's: a nonzero exit is still completed; killed is a signal; failed is a job that broke before it ran. */
export const JobState = Schema.Literals(['running', 'completed', 'killed', 'failed'])
export type JobState = typeof JobState.Type

export const JobInfo = Schema.Struct({
  job: Schema.String,
  command: Schema.String,
  state: JobState,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
})
export type JobInfo = typeof JobInfo.Type

/** The jobs of one Robot that this app holds, running and ended; a job the app lost by restarting is not among them. */
export const JobList = Rpc.make('JobList', {
  payload: { robot: Schema.String },
  success: Schema.Struct({ jobs: Schema.Array(JobInfo) }),
  error: HostError,
})

/**
 * What a job printed on one stream from a byte offset on: the text, how many bytes of the stream it covers (the next offset is the
 * offset plus that) and how long the stream is now. A job whose output outgrew the app's memory is read from the file the app keeps.
 */
export const JobOutput = Rpc.make('JobOutput', {
  payload: { job: Schema.String, stream: Schema.Literals(['out', 'err']), offset: Schema.Number },
  success: Schema.Struct({ text: Schema.String, bytes: Schema.Number, size: Schema.Number }),
  error: HostError,
})

/** Stop a job. The answer says whether it was still running. */
export const JobKill = Rpc.make('JobKill', {
  payload: { job: Schema.String },
  success: Schema.Struct({ outcome: Schema.Literals(['requested', 'already-finished']) }),
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

export class HostRpcs extends RpcGroup.make(Read, Write, CopyStat, Upload, Download, Glob, Grep, Delete, Run, JobList, JobOutput, JobKill, BrowserOpen, BrowserClose) {}

/** The sandbox state of a Host, as its heartbeat reports it. */
export const Sandbox = Schema.Literals(['full', 'partial', 'none'])
export type Sandbox = typeof Sandbox.Type

/** The shell a Host runs commands in: bash (Linux, macOS) or PowerShell 7 (Windows), so a Robot writes the right commands (v1.16 ticket 04, ob-vyyg). */
export const Shell = Schema.Literals(['bash', 'pwsh'])
export type Shell = typeof Shell.Type

/** What a Host reports every few seconds while connected (hs-7dlt). */
export const Heartbeat = Schema.Struct({
  version: Schema.String,
  /**
   * Which run of the app this is: new at every start, the same across reconnects. The jobs live in the app's memory, so a heartbeat
   * with another instance than the jobs were started under says the app restarted and they are gone (v1.16 ticket 03, ob-cgn1).
   */
  instance: Schema.String,
  platform: Schema.String,
  hostname: Schema.String,
  capabilities: Schema.Struct({
    /** A graphical session the host browser can open a window in. */
    graphical: Schema.Boolean,
    /** The Chrome or Chromium the host browser uses, or null when none was found. */
    chrome: Schema.NullOr(Schema.String),
    /** How completely this computer confines a command (v1.16, ob-n72n): full, partial (older kernel, Windows) or none (a confined command fails closed). */
    sandbox: Sandbox,
    /** The shell of this computer; absent in an app from before v1.16 (which ran bash). */
    shell: Schema.optional(Shell),
    /** Why no command can run here, in words for the owner (the Windows app without PowerShell 7, with the link to install it); absent when commands run. */
    shellProblem: Schema.optional(Schema.String),
  }),
})
export type Heartbeat = typeof Heartbeat.Type

/**
 * A heartbeat as the Worker accepts it: the fields v1.16 added are optional, so that an app from before v1.16 still shows as online.
 * Such an app ignores the access of a call, so the Worker refuses confined calls to it (the sandbox is unknown).
 */
export const ReceivedHeartbeat = Schema.Struct({
  version: Schema.String,
  instance: Schema.optional(Schema.String),
  platform: Schema.String,
  hostname: Schema.String,
  capabilities: Schema.Struct({
    graphical: Schema.Boolean,
    chrome: Schema.NullOr(Schema.String),
    sandbox: Schema.optional(Sandbox),
    shell: Schema.optional(Shell),
    shellProblem: Schema.optional(Schema.String),
  }),
})
export type ReceivedHeartbeat = typeof ReceivedHeartbeat.Type

/** The heartbeat a Host stored as JSON, or undefined when it is not one. */
export function parseHeartbeat(json: string): ReceivedHeartbeat | undefined {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(ReceivedHeartbeat)(JSON.parse(json)))
  } catch {
    return undefined
  }
}

/** How often a Host sends a heartbeat, and after how long without one it counts as offline. */
export const HEARTBEAT_MS = 15_000
export const OFFLINE_AFTER_MS = 45_000

/** A notification for the person at this computer (v1.3, pl-b5vp): shown natively, never by Web Push. */
export const HostNotification = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  /** The app path to open on click, e.g. "/#/r/<robot>". */
  url: Schema.String,
  tag: Schema.String,
})
export type HostNotification = typeof HostNotification.Type

/** A job ended on the Host without anyone waiting for it (v1.16 ticket 03, ob-ku5j): the Worker closes it and wakes the Robot. */
export const JobEnded = Schema.Struct({
  /** The name the Worker gave the job in Run. */
  job: Schema.String,
  state: Schema.Literals(['completed', 'killed', 'failed']),
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
})
export type JobEnded = typeof JobEnded.Type

/** One text frame on the Host's WebSocket; an unknown `t` is not a frame, so an older or newer peer's extra frames are dropped. */
export const Frame = Schema.Union([
  Schema.Struct({ t: Schema.Literal('rpc'), d: Schema.String }),
  Schema.Struct({ t: Schema.Literal('hb'), d: ReceivedHeartbeat }),
  Schema.Struct({ t: Schema.Literal('notify'), d: HostNotification }),
  Schema.Struct({ t: Schema.Literal('job'), d: JobEnded }),
])
export type Frame = typeof Frame.Type

export function frame(value: Frame): string {
  return JSON.stringify(value)
}

export function parseFrame(text: string): Frame | undefined {
  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Frame)(JSON.parse(text)))
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
  // Client ids are numbered across the process; each response goes back to the client that asked.
  const clientOf = new Map<string, number>()
  let lastClient = 0
  const protocol = RpcClient.Protocol.make(Effect.fnUntraced(function* (writeResponse) {
    write = (response) => {
      const requestId = (response as { requestId?: unknown }).requestId
      const clientId = requestId === undefined ? lastClient : (clientOf.get(String(requestId)) ?? lastClient)
      if ((response as { _tag?: string })._tag === 'Exit') clientOf.delete(String(requestId))
      return writeResponse(clientId, response as never)
    }
    return {
      send: (clientId: number, request: unknown) => Effect.sync(() => {
        lastClient = clientId
        const id = (request as { id?: unknown }).id
        if (id !== undefined) clientOf.set(String(id), clientId)
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
