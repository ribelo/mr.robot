/**
 * A fake Mr. Robot app (v1.2): pairs, connects, heartbeats and answers the Host RPCs the Worker calls, so that tests drive Hosts through
 * the edge API as the real app would be driven. State is module-level and per test file; a test resets what it uses.
 */
import { env, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { expect } from 'vitest'
import { CopyFailed, downloadFile, frame, globToRegExp, GREP_MAX_MATCHES, HOST_PROTOCOL_VERSION, HostError, LISTING_MAX_FILES, HostRpcs, NO_SUCH_JOB, parseFrame, serveHost, skipped, uploadFile, type CopyIo, type HostAccess, type JobEnded, type HostNotification, type JobState, type Sandbox, type SandboxReport, type Shell } from '@mr-robot/host-protocol'
import { fakeR2 } from './fake-r2.ts'
import { api } from './api.ts'

const ANNA = 'anna@example.com'

export const ran: string[] = []
/** Every command with the directory, mode and roots it reached the app with (v1.16 ticket 02), and every file call with its path and mode. */
export const hostRuns: Array<{ command: string; cwd: string | undefined; access: HostAccess; background: boolean; timeoutMs: number | undefined; job: string }> = []
export const hostFileCalls: Array<{ rpc: string; path: string; access: HostAccess }> = []
const open: WebSocket[] = []
let runs = 0
/** The fake host's disk (v1.15, copy): path → bytes. */
export const hostDisk = new Map<string, Uint8Array>()
/** Downloads that came in windows and are not whole yet, by the Worker's id of the copy. */
const downloading = new Map<string, Uint8Array>()
/** What the fake app did to copy: each Upload and Download it was handed, with the URLs' keys. */
export const hostCopies: Array<{ rpc: 'Upload' | 'Download'; path: string; size: number; parts: number }> = []
/** The copy engine's network is R2 played from the bucket, and its pauses between attempts are instant. */
const copyIo = (): CopyIo => ({ fetch: fakeR2(env.FILES), sleep: async () => undefined })
const hostError = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error) })
/** Answers to commands, in order: the first that returns a result wins; every other command echoes. Cleared by the test. */
export const hostCommands: Array<(command: string, access: HostAccess) => { stdout: string; stderr?: string; exitCode?: number; sandbox?: SandboxReport } | undefined> = []

/**
 * A job the fake app holds, as DSH's jobs-local would (v1.16 ticket 03): lost when the app restarts. `awaited` while a Run call waits for
 * it; one that ended within its call is kept too, as the app keeps it (deep review P11).
 */
interface FakeJob { ref: string; command: string; cwd: string; state: JobState; exitCode: number | null; signal: string | null; out: string; err: string; startedAt: number; finishedAt: number | null; awaited: boolean }
export const hostJobs = new Map<string, FakeJob>()
/** Commands that do not end by themselves: a test ends them with finish. Cleared by closeHosts. */
export const heldCommands = new Set<string>()
/** The job calls the fake app received, in order, as "JobKill <ref>" and the like. */
export const hostJobCalls: string[] = []
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** The fake disk's directories (v1.21, the Workspace picker), absolute; a file's directories count too. Cleared by closeHosts. */
export const hostDirectories = new Set<string>()
/** The Workspace sessions the Worker closed on the fake app, by the Robot's directory name. */
export const workspaceCloses: string[] = []
const FAKE_HOME = '/home/anna'
const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 1))
const expanded = (path: string): string => (path === '~' ? FAKE_HOME : path.startsWith('~/') ? `${FAKE_HOME}/${path.slice(2)}` : path.startsWith('/') ? path : `${FAKE_HOME}/${path}`).replace(/\/+$/, '') || '/'
/** A path with . and .. taken away. */
const normal = (path: string): string => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}
/** A path of a call as the app resolves it: on the Workspace a relative path starts in the Robot's current directory (access.cwd); otherwise as given. */
const onPlace = (access: HostAccess, path: string): string => (access.cwd !== undefined && !path.startsWith('/') && !path.startsWith('~') ? normal(`${access.cwd}/${path}`) : path)

/** Every directory the fake disk knows: the listed ones, and those its files lie in. */
const knownDirectories = (): Set<string> => {
  const all = new Set<string>()
  for (const path of [...hostDirectories, ...[...hostDisk.keys()].map(parentOf)]) {
    for (let at = path; at !== '/' && at !== ''; at = parentOf(at)) all.add(at)
  }
  return all
}

/** Write roots that are symbolic links on the fake disk: like the app, it refuses a confined command under a grant naming one (deep review P1b). Cleared by closeHosts. */
export const linkedRoots = new Set<string>()

/** The app refuses a change in read-only mode, with the code the Worker looks for. */
const readOnly = (access: HostAccess, path: string) => access.mode === 'read-only'
  ? Effect.fail(new HostError({ message: `${path} was not written: this grant is read-only, so nothing on this computer may be changed.`, code: 'SANDBOX_DENIED' }))
  : undefined

const skippedPath = skipped


/** A fake Mr. Robot app: pairs, connects, heartbeats and answers host calls (hs-xax9). Its notifications (notify frames) are kept in `notices`. */
export async function fakeHost(name = 'Desk', options: { sandbox?: Sandbox; platform?: string; shell?: Shell; legacy?: boolean; owner?: string; protocolVersion?: number } = {}) {
  const owner = options.owner ?? ANNA
  const platform = options.platform ?? 'linux'
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform }) })
  const { code, approveUrl } = (await start.json()) as { code: string; approveUrl: string }
  expect(approveUrl).toBe(`https://mr-robot.test/#/pair/${code}`)
  expect((await api<{ name: string }>(owner, `/api/hosts/pair/${code}`)).body.name).toBe(name)
  await api(owner, `/api/hosts/pair/${code}`, { body: {} })
  const paired = (await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { status: string; hostId: string; token: string }
  expect(paired.status).toBe('paired')
  // The token is handed over once.
  expect(((await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { status: string }).status).toBe('expired')
  const connect = (token = paired.token) => SELF.fetch('https://mr-robot.test/api/host/connect', { headers: { upgrade: 'websocket', 'x-host-id': paired.hostId, authorization: `Bearer ${token}` } })
  const response = await connect()
  const socket = response.webSocket!
  socket.accept()
  open.push(socket)
  const closes: number[] = []
  socket.addEventListener('close', (event) => closes.push(event.code))
  const handlers = HostRpcs.toLayer({
    Read: ({ path: given, access }) => {
      const path = onPlace(access, given)
      hostFileCalls.push({ rpc: 'Read', path, access })
      if (path === '/root/secret') return Effect.fail(new HostError({ message: 'permission denied', code: 'EACCES' }))
      const bytes = hostDisk.get(path)
      if (bytes === undefined) return Effect.succeed({ path, size: 5, text: 'hello', base64: null })
      try {
        return Effect.succeed({ path, size: bytes.length, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), base64: null })
      } catch {
        return Effect.succeed({ path, size: bytes.length, text: null, base64: btoa(String.fromCharCode(...bytes)) })
      }
    },
    Write: ({ path: given, text, base64, access }) => {
      const path = onPlace(access, given)
      hostFileCalls.push({ rpc: 'Write', path, access })
      return readOnly(access, path) ?? Effect.sync(() => {
      const bytes = base64 === undefined ? new TextEncoder().encode(text ?? '') : Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      hostDisk.set(path, bytes)
      return { path, bytes: bytes.length }
      })
    },
    CopyStat: ({ path }) => {
      const bytes = hostDisk.get(path)
      return bytes === undefined ? Effect.fail(new HostError({ message: `no such file: ${path}`, code: 'ENOENT' })) : Effect.succeed({ path, size: bytes.length })
    },
    // The real copy engine of the app (host-protocol), over the fake disk and the fake R2.
    Upload: ({ path, size, parts }) => Effect.tryPromise({
      try: async (signal) => {
        hostCopies.push({ rpc: 'Upload', path, size, parts: parts.length })
        const bytes = hostDisk.get(path)
        if (bytes === undefined) throw new CopyFailed({ message: `no such file: ${path}` })
        return { path, size, etags: await uploadFile({ size: async () => bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, size, parts, copyIo(), signal) }
      },
      catch: hostError,
    }),
    Download: ({ copy, path, url, size, partBytes, from, until, access }) => readOnly(access, path) ?? Effect.tryPromise({
      try: async (signal) => {
        hostFileCalls.push({ rpc: 'Download', path, access })
        hostCopies.push({ rpc: 'Download', path, size, parts: Math.ceil((Math.min(until, size) - from) / partBytes) })
        // A download in windows keeps what arrived, for its copy, until the last window puts the file in place.
        const kept = downloading.get(copy)
        if (from > 0 && kept === undefined) throw new CopyFailed({ message: `${path} was not written: this copy stopped on this computer` })
        const received = kept ?? new Uint8Array(size)
        const written = await downloadFile({
          write: async (offset, bytes) => { received.set(bytes, offset) },
          finish: async () => { downloading.delete(copy); hostDisk.set(path, received) },
          release: async () => { downloading.set(copy, received) },
          abandon: async () => { downloading.delete(copy) },
        }, { url, size, partBytes, from, until }, copyIo(), signal)
        return { path, bytes: written }
      },
      catch: hostError,
    }),
    // Like the app, a listing walks at most LISTING_MAX_FILES files and a search returns at most GREP_MAX_MATCHES matches, and each says when it stopped early.
    Glob: ({ pattern, access }) => Effect.sync(() => {
      hostFileCalls.push({ rpc: 'Glob', path: pattern, access })
      const matcher = globToRegExp(pattern)
      const walked = [...hostDisk.keys()].filter((path) => !skippedPath(path)).sort()
      return { paths: walked.slice(0, LISTING_MAX_FILES).filter((path) => matcher.test(path)), truncated: walked.length > LISTING_MAX_FILES }
    }),
    Grep: ({ pattern, ignoreCase, glob, path, access }) => Effect.sync(() => {
      hostFileCalls.push({ rpc: 'Grep', path: path ?? '', access })
      const regex = new RegExp(pattern, ignoreCase ? 'i' : '')
      const files = glob === undefined ? undefined : globToRegExp(glob)
      const matches = [...hostDisk.entries()].filter(([file]) => !skippedPath(file) && (files === undefined || files.test(file)) && (path === undefined || file.startsWith(`${path}/`))).sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([file, bytes]) => new TextDecoder().decode(bytes).split('\n').flatMap((line, index) => (regex.test(line) ? [{ path: file, line: index + 1, text: line }] : [])))
      return { matches: matches.slice(0, GREP_MAX_MATCHES), truncated: matches.length > GREP_MAX_MATCHES }
    }),
    Delete: ({ path: given, access }) => {
      const path = onPlace(access, given)
      hostFileCalls.push({ rpc: 'Delete', path, access })
      const denied = readOnly(access, path)
      if (denied !== undefined) return denied
      if (!hostDisk.delete(path)) return Effect.fail(new HostError({ message: `No file ${path}; nothing was deleted.`, code: 'ENOENT' }))
      return Effect.succeed({ path })
    },
    Run: ({ command, cwd, timeoutMs, background, job, access }) => {
      ran.push(command)
      hostRuns.push({ command, cwd, access, background, timeoutMs, job })
      // The app fails a confined command closed where it has no sandbox (ob-n72n).
      if (access.mode !== 'full' && options.sandbox === 'none') return Effect.fail(new HostError({ message: 'This computer has no usable sandbox', code: 'SANDBOX_UNAVAILABLE' }))
      const linked = access.mode === 'full' ? undefined : access.roots.find((root) => linkedRoots.has(root))
      if (linked !== undefined) return Effect.fail(new HostError({ message: `No command runs and no file is changed under this grant on this computer: ${linked} is a symbolic link on the way to ${linked}, and the sandbox would let you change what it points at.`, code: 'SANDBOX_DENIED' }))
      const scripted = hostCommands.map((answer) => answer(command, access)).find((answer) => answer !== undefined)
      const sandbox = scripted?.sandbox ?? (access.mode === 'full' ? { mode: access.mode, denied: false } : { mode: access.mode, denied: false, enforcement: options.sandbox === 'partial' ? 'partial' as const : 'full' as const })
      const where = cwd === undefined ? access.cwd ?? `/home/anna/mr-robot/${access.robot}` : onPlace(access, cwd)
      const held = heldCommands.has(command)
      const stdout = scripted?.stdout ?? `ran: ${command}`
      const record: FakeJob = { ref: job, command, cwd: where, state: held ? 'running' : 'completed', exitCode: held ? null : scripted?.exitCode ?? 0, signal: null, out: held ? '' : stdout, err: held ? '' : scripted?.stderr ?? '', startedAt: Date.now(), finishedAt: held ? null : Date.now(), awaited: !background }
      hostJobs.set(job, record)
      const limit = timeoutMs ?? 120_000
      if (background) return Effect.succeed({ kind: 'background' as const, cwd: where, timeoutMs: limit, jobId: job })
      // The call waits for the command up to its limit, as the app does; a command that is still running then goes on as a job. When
      // the connection drops first, the command goes on as a job too, and the call never answers (deep review P11).
      return Effect.promise(async (signal) => {
        for (const started = Date.now(); record.state === 'running' && !signal.aborted && Date.now() - started < limit; ) await new Promise((resolve) => setTimeout(resolve, 25))
        record.awaited = false
        if (record.state === 'running') return { kind: 'promoted' as const, cwd: where, timeoutMs: limit, jobId: job, output: record.out }
        return {
          kind: 'foreground' as const, cwd: where, exitCode: record.exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: limit,
          stdout: { text: record.out, truncated: false }, stderr: { text: record.err, truncated: false }, sandbox,
        }
      })
    },
    JobList: ({ robot }) => Effect.sync(() => {
      hostJobCalls.push(`JobList ${robot}`)
      return { jobs: [...hostJobs.values()].filter((entry) => entry.ref.startsWith(`${robot}:`)).map((entry) => ({ job: entry.ref, command: entry.command, state: entry.state, exitCode: entry.exitCode, signal: entry.signal, startedAt: entry.startedAt, finishedAt: entry.finishedAt })) }
    }),
    JobOutput: ({ job, stream, offset }) => {
      hostJobCalls.push(`JobOutput ${job} ${stream} ${offset}`)
      const entry = hostJobs.get(job)
      if (entry === undefined) return Effect.fail(new HostError({ message: `no job ${job}`, code: NO_SUCH_JOB }))
      const all = bytes(stream === 'out' ? entry.out : entry.err)
      const piece = all.subarray(offset, offset + 262_144)
      return Effect.succeed({ text: new TextDecoder().decode(piece), bytes: piece.length, size: all.length })
    },
    JobKill: ({ job }) => {
      hostJobCalls.push(`JobKill ${job}`)
      const entry = hostJobs.get(job)
      if (entry === undefined) return Effect.fail(new HostError({ message: `no job ${job}`, code: NO_SUCH_JOB }))
      if (entry.state !== 'running') return Effect.succeed({ outcome: 'already-finished' as const })
      Object.assign(entry, { state: 'killed' as const, signal: 'SIGTERM', finishedAt: Date.now() })
      return Effect.succeed({ outcome: 'requested' as const })
    },
    BrowserOpen: () => Effect.fail(new HostError({ message: 'no Chrome in the fake host' })),
    BrowserClose: () => Effect.void,
    ListDirectory: ({ path }) => {
      const full = expanded(path)
      const known = knownDirectories()
      if (!known.has(full)) return Effect.fail(new HostError({ message: `ENOENT: no such directory, scandir '${full}'`, code: 'ENOENT' }))
      return Effect.succeed({ path: full, directories: [...known].filter((dir) => parentOf(dir) === full).map((dir) => dir.slice(full.length + 1)).sort(), truncated: false })
    },
    Stat: ({ path }) => Effect.sync(() => {
      const full = expanded(path)
      const known = knownDirectories()
      const kind = known.has(full) ? 'directory' as const : hostDisk.has(full) ? 'file' as const : 'missing' as const
      let repository: string | null = null
      for (let at = full; kind === 'directory' && repository === null && at !== '/' && at !== ''; at = parentOf(at)) if (known.has(`${at}/.git`) || hostDisk.has(`${at}/.git`)) repository = at
      return { path: full, kind, link: linkedRoots.has(full) ? full : null, repository }
    }),
    WorkspaceClose: ({ robot }) => Effect.sync(() => { workspaceCloses.push(robot) }),
    WorkingDirectory: ({ cd, access }) => {
      const target = cd.startsWith('/') || cd.startsWith('~') || access.cwd === undefined ? expanded(cd) : normal(`${access.cwd}/${cd}`)
      if (!knownDirectories().has(target)) return Effect.fail(new HostError({ message: `${target} does not exist`, code: 'ENOENT' }))
      const repository = access.workspace?.repository
      if (repository === undefined || (target !== repository && !target.startsWith(`${repository}/`))) return Effect.fail(new HostError({ message: `${target} is outside the repository ${repository}; the current directory stays within it`, code: 'OUTSIDE_REPOSITORY' }))
      return Effect.succeed({ path: target })
    },
  })
  let current = socket
  /** The server of the current connection: interrupted when it drops, as the app's link does, so that a waiting Run call ends. */
  let serving: Fiber.Fiber<never, never> | undefined
  /** Job frames of jobs that ended while the connection was down: the app sends them when it is back. */
  const unsent: string[] = []
  const tell = (text: string) => {
    if (current.readyState === WebSocket.READY_STATE_OPEN) current.send(text)
    else unsent.push(text)
  }
  const notices: HostNotification[] = []
  let instance = `app-run-${++runs}`
  // An app from before v1.16 says nothing of its sandbox, shell or run, and ignores the access of a call.
  const beat = (as = instance) => current.send(frame({ t: 'hb', d: options.legacy === true
    ? { version: '0.1.0', platform, hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome' } }
    : { version: '0.1.0', protocolVersion: options.protocolVersion ?? HOST_PROTOCOL_VERSION, instance: as, platform, hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome', sandbox: options.sandbox ?? 'full', shell: options.shell ?? 'bash' } } }))
  /** The app serves the Host RPCs on a socket: its first connection, and each time it comes back. */
  const serve = (on: WebSocket) => {
    current = on
    const host = serveHost(handlers, (text) => on.send(text))
    on.addEventListener('message', (event) => {
      const parsed = parseFrame(String(event.data))
      if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
      if (parsed?.t === 'notify') notices.push(parsed.d)
    })
    const fiber = Effect.runFork(host.server)
    serving = fiber
    // A connection that ends stops its server, as the app's link does: a Run call still waiting then ends.
    on.addEventListener('close', () => { Effect.runFork(Fiber.interrupt(fiber)) })
    beat()
    for (const text of unsent.splice(0)) on.send(text)
  }
  /** The connection drops: the app stops serving it. */
  const disconnect = async () => {
    if (serving !== undefined) await Effect.runPromise(Fiber.interrupt(serving))
    current.close(1000)
  }
  /** The same run of the app connects again. */
  const reconnect = async () => {
    const again = (await connect()).webSocket!
    again.accept()
    open.push(again)
    serve(again)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  serve(socket)
  await new Promise((resolve) => setTimeout(resolve, 100))
  /** The job's state, found by its command (the latest one). */
  const jobOf = (command: string): FakeJob => {
    const found = [...hostJobs.values()].filter((entry) => entry.command === command).at(-1)
    if (found === undefined) throw new Error(`the fake app holds no job "${command}"`)
    return found
  }
  return {
    hostId: paired.hostId, token: paired.token, socket, closes, connect, notices,
    /** The job printed something. */
    print: (command: string, text: string, stream: 'out' | 'err' = 'out') => { const job = jobOf(command); if (stream === 'out') job.out += text; else job.err += text },
    /** The job ended; the app tells the Worker with a job frame unless the test says its connection was down. */
    finish: (command: string, result: { stdout?: string; stderr?: string; exitCode?: number; frame?: boolean } = {}) => {
      const job = jobOf(command)
      job.out += result.stdout ?? ''
      job.err += result.stderr ?? ''
      Object.assign(job, { state: 'completed' as const, exitCode: result.exitCode ?? 0, finishedAt: Date.now() })
      // A Run call that waits for it carries the result; otherwise a frame, held while the connection is down, as the app does.
      if (result.frame !== false && !job.awaited) tell(frame({ t: 'job', d: { job: job.ref, state: 'completed', exitCode: job.exitCode, signal: null } satisfies JobEnded }))
    },
    /** The connection drops and the same run of the app connects again (a network blip): the jobs are still there. */
    blip: async () => {
      await disconnect()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await reconnect()
    },
    /** The connection drops and stays down. */
    drop: async () => { await disconnect(); await new Promise((resolve) => setTimeout(resolve, 100)) },
    /** After a drop, the same run of the app connects again. */
    back: reconnect,
    /** The app restarts: a new run, with no jobs, connected again. */
    restart: async () => {
      await disconnect()
      hostJobs.clear()
      unsent.length = 0
      instance = `app-run-${++runs}`
      await new Promise((resolve) => setTimeout(resolve, 50))
      await reconnect()
    },
  }
}

/** Close the sockets of the fake hosts a test opened. */
export async function closeHosts(): Promise<void> {
  hostJobs.clear()
  heldCommands.clear()
  linkedRoots.clear()
  hostDirectories.clear()
  workspaceCloses.length = 0
  hostJobCalls.length = 0
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
}
