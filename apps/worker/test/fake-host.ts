/**
 * A fake Mr. Robot app (v1.2): pairs, connects, heartbeats and answers the Host RPCs the Worker calls, so that tests drive Hosts through
 * the edge API as the real app would be driven. State is module-level and per test file; a test resets what it uses.
 */
import { env, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import { CopyFailed, downloadFile, frame, globToRegExp, HostError, HostRpcs, NO_SUCH_JOB, parseFrame, serveHost, SKIPPED_DIRECTORIES, uploadFile, type CopyIo, type HostAccess, type JobEnded, type HostNotification, type JobState, type Sandbox, type SandboxReport, type Shell } from '@mr-robot/host-protocol'
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
/** Downloads that came in windows and are not whole yet. */
const downloading = new Map<string, Uint8Array>()
/** What the fake app did to copy: each Upload and Download it was handed, with the URLs' keys. */
export const hostCopies: Array<{ rpc: 'Upload' | 'Download'; path: string; size: number; parts: number }> = []
/** The copy engine's network is R2 played from the bucket, and its pauses between attempts are instant. */
const copyIo = (): CopyIo => ({ fetch: fakeR2(env.FILES), sleep: async () => undefined })
const hostError = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error) })
/** Answers to commands, in order: the first that returns a result wins; every other command echoes. Cleared by the test. */
export const hostCommands: Array<(command: string, access: HostAccess) => { stdout: string; stderr?: string; exitCode?: number; sandbox?: SandboxReport } | undefined> = []

/** A job the fake app holds, as DSH's jobs-local would (v1.16 ticket 03): lost when the app restarts. */
interface FakeJob { ref: string; command: string; cwd: string; state: JobState; exitCode: number | null; signal: string | null; out: string; err: string; startedAt: number; finishedAt: number | null }
export const hostJobs = new Map<string, FakeJob>()
/** Commands that do not end by themselves: a test ends them with finish. Cleared by closeHosts. */
export const heldCommands = new Set<string>()
/** The job calls the fake app received, in order, as "JobKill <ref>" and the like. */
export const hostJobCalls: string[] = []
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** The app refuses a change in read-only mode, with the code the Worker looks for. */
const readOnly = (access: HostAccess, path: string) => access.mode === 'read-only'
  ? Effect.fail(new HostError({ message: `${path} was not written: this grant is read-only, so nothing on this computer may be changed.`, code: 'SANDBOX_DENIED' }))
  : undefined

const skippedPath = (path: string): boolean => path.split('/').some((segment) => (SKIPPED_DIRECTORIES as readonly string[]).includes(segment))


/** A fake Mr. Robot app: pairs, connects, heartbeats and answers host calls (hs-xax9). Its notifications (notify frames) are kept in `notices`. */
export async function fakeHost(name = 'Desk', options: { sandbox?: Sandbox; platform?: string; shell?: Shell; legacy?: boolean } = {}) {
  const platform = options.platform ?? 'linux'
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform }) })
  const { code, approveUrl } = (await start.json()) as { code: string; approveUrl: string }
  expect(approveUrl).toBe(`https://mr-robot.test/#/pair/${code}`)
  expect((await api<{ name: string }>(ANNA, `/api/hosts/pair/${code}`)).body.name).toBe(name)
  await api(ANNA, `/api/hosts/pair/${code}`, { body: {} })
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
    Read: ({ path, access }) => {
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
    Write: ({ path, text, base64, access }) => {
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
      try: async () => {
        hostCopies.push({ rpc: 'Upload', path, size, parts: parts.length })
        const bytes = hostDisk.get(path)
        if (bytes === undefined) throw new CopyFailed({ message: `no such file: ${path}` })
        return { path, size, etags: await uploadFile({ size: async () => bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, size, parts, copyIo()) }
      },
      catch: hostError,
    }),
    Download: ({ path, url, size, partBytes, from, until, access }) => readOnly(access, path) ?? Effect.tryPromise({
      try: async () => {
        hostFileCalls.push({ rpc: 'Download', path, access })
        hostCopies.push({ rpc: 'Download', path, size, parts: Math.ceil((Math.min(until, size) - from) / partBytes) })
        // A download in windows keeps what arrived until the last window puts the file in place.
        const received = from > 0 ? downloading.get(path) ?? new Uint8Array(size) : new Uint8Array(size)
        const written = await downloadFile({
          write: async (offset, bytes) => { received.set(bytes, offset) },
          finish: async () => { downloading.delete(path); hostDisk.set(path, received) },
          release: async () => { downloading.set(path, received) },
          abandon: async () => { downloading.delete(path) },
        }, { url, size, partBytes, from, until }, copyIo())
        return { path, bytes: written }
      },
      catch: hostError,
    }),
    Glob: ({ pattern, access }) => Effect.sync(() => {
      hostFileCalls.push({ rpc: 'Glob', path: pattern, access })
      const matcher = globToRegExp(pattern)
      return { paths: [...hostDisk.keys()].filter((path) => !skippedPath(path) && matcher.test(path)).sort(), truncated: false }
    }),
    Grep: ({ pattern, ignoreCase, glob, path, access }) => Effect.sync(() => {
      hostFileCalls.push({ rpc: 'Grep', path: path ?? '', access })
      const regex = new RegExp(pattern, ignoreCase ? 'i' : '')
      const files = glob === undefined ? undefined : globToRegExp(glob)
      const matches = [...hostDisk.entries()].filter(([file]) => !skippedPath(file) && (files === undefined || files.test(file)) && (path === undefined || file.startsWith(`${path}/`))).sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([file, bytes]) => new TextDecoder().decode(bytes).split('\n').flatMap((line, index) => (regex.test(line) ? [{ path: file, line: index + 1, text: line }] : [])))
      return { matches }
    }),
    Delete: ({ path, access }) => {
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
      const scripted = hostCommands.map((answer) => answer(command, access)).find((answer) => answer !== undefined)
      const sandbox = scripted?.sandbox ?? (access.mode === 'full' ? { mode: access.mode, denied: false } : { mode: access.mode, denied: false, enforcement: options.sandbox === 'partial' ? 'partial' as const : 'full' as const })
      const where = cwd ?? `/home/anna/mr-robot/${access.robot}`
      const held = heldCommands.has(command)
      const stdout = scripted?.stdout ?? `ran: ${command}`
      const record: FakeJob = { ref: job, command, cwd: where, state: held ? 'running' : 'completed', exitCode: held ? null : scripted?.exitCode ?? 0, signal: null, out: held ? '' : stdout, err: held ? '' : scripted?.stderr ?? '', startedAt: Date.now(), finishedAt: held ? null : Date.now() }
      hostJobs.set(job, record)
      const limit = timeoutMs ?? 120_000
      if (background) return Effect.succeed({ kind: 'background' as const, cwd: where, timeoutMs: limit, jobId: job })
      // The call waits for the command up to its limit, as the app does; a command that is still running then goes on as a job.
      return Effect.promise(async () => {
        for (const started = Date.now(); record.state === 'running' && Date.now() - started < limit; ) await new Promise((resolve) => setTimeout(resolve, 25))
        if (record.state === 'running') return { kind: 'promoted' as const, cwd: where, timeoutMs: limit, jobId: job, output: record.out }
        hostJobs.delete(job)
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
  })
  let current = socket
  const notices: HostNotification[] = []
  let instance = `app-run-${++runs}`
  // An app from before v1.16 says nothing of its sandbox, shell or run, and ignores the access of a call.
  const beat = (as = instance) => current.send(frame({ t: 'hb', d: options.legacy === true
    ? { version: '0.1.0', platform, hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome' } }
    : { version: '0.1.0', instance: as, platform, hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome', sandbox: options.sandbox ?? 'full', shell: options.shell ?? 'bash' } } }))
  /** The app serves the Host RPCs on a socket: its first connection, and each time it comes back. */
  const serve = (on: WebSocket) => {
    current = on
    const host = serveHost(handlers, (text) => on.send(text))
    on.addEventListener('message', (event) => {
      const parsed = parseFrame(String(event.data))
      if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
      if (parsed?.t === 'notify') notices.push(parsed.d)
    })
    Effect.runFork(host.server)
    beat()
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
      if (result.frame !== false) current.send(frame({ t: 'job', d: { job: job.ref, state: 'completed', exitCode: job.exitCode, signal: null } satisfies JobEnded }))
    },
    /** The connection drops and the same run of the app connects again (a network blip): the jobs are still there. */
    blip: async () => {
      current.close(1000)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const again = (await connect()).webSocket!
      again.accept()
      open.push(again)
      serve(again)
      await new Promise((resolve) => setTimeout(resolve, 100))
    },
    /** The connection drops and stays down. */
    drop: async () => { current.close(1000); await new Promise((resolve) => setTimeout(resolve, 100)) },
    /** The app restarts: a new run, with no jobs, connected again. */
    restart: async () => {
      current.close(1000)
      hostJobs.clear()
      instance = `app-run-${++runs}`
      await new Promise((resolve) => setTimeout(resolve, 50))
      const again = (await connect()).webSocket!
      again.accept()
      open.push(again)
      serve(again)
      await new Promise((resolve) => setTimeout(resolve, 100))
    },
  }
}

/** Close the sockets of the fake hosts a test opened. */
export async function closeHosts(): Promise<void> {
  hostJobs.clear()
  heldCommands.clear()
  hostJobCalls.length = 0
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
}
