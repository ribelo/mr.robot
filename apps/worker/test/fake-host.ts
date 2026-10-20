/**
 * A fake Mr. Robot app (v1.2): pairs, connects, heartbeats and answers the Host RPCs the Worker calls, so that tests drive Hosts through
 * the edge API as the real app would be driven. State is module-level and per test file; a test resets what it uses.
 */
import { env, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import { CopyFailed, downloadFile, frame, globToRegExp, HostError, HostRpcs, parseFrame, serveHost, SKIPPED_DIRECTORIES, uploadFile, type CopyIo, type HostAccess, type HostNotification, type Sandbox, type SandboxReport, type Shell } from '@mr-robot/host-protocol'
import { fakeR2 } from './fake-r2.ts'
import { api } from './api.ts'

const ANNA = 'anna@example.com'

export const ran: string[] = []
/** Every command with the directory, mode and roots it reached the app with (v1.16 ticket 02), and every file call with its path and mode. */
export const hostRuns: Array<{ command: string; cwd: string | undefined; access: HostAccess }> = []
export const hostFileCalls: Array<{ rpc: string; path: string; access: HostAccess }> = []
const open: WebSocket[] = []
/** The fake host's disk (v1.15, copy): path → bytes. */
export const hostDisk = new Map<string, Uint8Array>()
/** What the fake app did to copy: each Upload and Download it was handed, with the URLs' keys. */
export const hostCopies: Array<{ rpc: 'Upload' | 'Download'; path: string; size: number; parts: number }> = []
/** The copy engine's network is R2 played from the bucket, and its pauses between attempts are instant. */
const copyIo = (): CopyIo => ({ fetch: fakeR2(env.FILES), sleep: async () => undefined })
const hostError = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error) })
/** Answers to commands, in order: the first that returns a result wins; every other command echoes. Cleared by the test. */
export const hostCommands: Array<(command: string, access: HostAccess) => { stdout: string; stderr?: string; exitCode?: number; sandbox?: SandboxReport } | undefined> = []

const skippedPath = (path: string): boolean => path.split('/').some((segment) => (SKIPPED_DIRECTORIES as readonly string[]).includes(segment))


/** A fake Mr. Robot app: pairs, connects, heartbeats and answers host calls (hs-xax9). Its notifications (notify frames) are kept in `notices`. */
export async function fakeHost(name = 'Desk', options: { sandbox?: Sandbox; platform?: string; shell?: Shell } = {}) {
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
    Write: ({ path, text, base64, access }) => Effect.sync(() => {
      hostFileCalls.push({ rpc: 'Write', path, access })
      const bytes = base64 === undefined ? new TextEncoder().encode(text ?? '') : Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      hostDisk.set(path, bytes)
      return { path, bytes: bytes.length }
    }),
    CopyStat: ({ path }) => {
      const bytes = hostDisk.get(path)
      return bytes === undefined ? Effect.fail(new HostError({ message: `no such file: ${path}`, code: 'ENOENT' })) : Effect.succeed({ path, size: bytes.length })
    },
    // The real copy engine of the app (host-protocol), over the fake disk and the fake R2.
    Upload: ({ path, size, parts }) => Effect.tryPromise({
      try: async () => {
        hostCopies.push({ rpc: 'Upload', path, size, parts: parts.length })
        const bytes = hostDisk.get(path)
        if (bytes === undefined) throw new CopyFailed(`no such file: ${path}`)
        return { path, size, etags: await uploadFile({ size: async () => bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }, size, parts, copyIo()) }
      },
      catch: hostError,
    }),
    Download: ({ path, url, size, partBytes }) => Effect.tryPromise({
      try: async () => {
        hostCopies.push({ rpc: 'Download', path, size, parts: Math.ceil(size / partBytes) })
        const received = new Uint8Array(size)
        const written = await downloadFile({ write: async (offset, bytes) => { received.set(bytes, offset) }, finish: async () => { hostDisk.set(path, received) }, abandon: async () => undefined }, { url, size, partBytes }, copyIo())
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
      if (!hostDisk.delete(path)) return Effect.fail(new HostError({ message: `No file ${path}; nothing was deleted.`, code: 'ENOENT' }))
      return Effect.succeed({ path })
    },
    Run: ({ command, cwd, access }) => {
      ran.push(command)
      hostRuns.push({ command, cwd, access })
      // The app fails a confined command closed where it has no sandbox (ob-n72n).
      if (access.mode !== 'full' && options.sandbox === 'none') return Effect.fail(new HostError({ message: 'This computer has no usable sandbox', code: 'SANDBOX_UNAVAILABLE' }))
      const scripted = hostCommands.map((answer) => answer(command, access)).find((answer) => answer !== undefined)
      const sandbox = scripted?.sandbox ?? (access.mode === 'full' ? { mode: access.mode, denied: false } : { mode: access.mode, denied: false, enforcement: options.sandbox === 'partial' ? 'partial' as const : 'full' as const })
      return Effect.succeed({
        kind: 'foreground' as const, cwd: cwd ?? `/home/anna/mr-robot/${access.robot}`, exitCode: scripted?.exitCode ?? 0, signal: null, timedOut: false, aborted: false, timeoutMs: 120_000,
        stdout: { text: scripted?.stdout ?? `ran: ${command}`, truncated: false }, stderr: { text: scripted?.stderr ?? '', truncated: false }, sandbox,
      })
    },
    BrowserOpen: () => Effect.fail(new HostError({ message: 'no Chrome in the fake host' })),
    BrowserClose: () => Effect.void,
  })
  const host = serveHost(handlers, (text) => socket.send(text))
  const notices: HostNotification[] = []
  socket.addEventListener('message', (event) => {
    const parsed = parseFrame(String(event.data))
    if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
    if (parsed?.t === 'notify') notices.push(parsed.d)
  })
  Effect.runFork(host.server)
  socket.send(frame({ t: 'hb', d: { version: '0.1.0', platform, hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome', sandbox: options.sandbox ?? 'full', shell: options.shell ?? 'bash' } } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { hostId: paired.hostId, token: paired.token, socket, closes, connect, notices }
}

/** Close the sockets of the fake hosts a test opened. */
export async function closeHosts(): Promise<void> {
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
}
