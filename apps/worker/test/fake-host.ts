/**
 * A fake Mr. Robot app (v1.2): pairs, connects, heartbeats and answers the Host RPCs the Worker calls, so that tests drive Hosts through
 * the edge API as the real app would be driven. State is module-level and per test file; a test resets what it uses.
 */
import { env, SELF } from 'cloudflare:test'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import { CopyFailed, downloadFile, frame, HostError, HostRpcs, parseFrame, serveHost, uploadFile, type CopyIo } from '@mr-robot/host-protocol'
import { fakeR2 } from './fake-r2.ts'
import { api } from './api.ts'

const ANNA = 'anna@example.com'

export const ran: string[] = []
const open: WebSocket[] = []
/** The fake host's disk (v1.15, copy): path → bytes. */
export const hostDisk = new Map<string, Uint8Array>()
/** What the fake app did to copy: each Upload and Download it was handed, with the URLs' keys. */
export const hostCopies: Array<{ rpc: 'Upload' | 'Download'; path: string; size: number; parts: number }> = []
/** The copy engine's network is R2 played from the bucket, and its pauses between attempts are instant. */
const copyIo = (): CopyIo => ({ fetch: fakeR2(env.FILES), sleep: async () => undefined })
const hostError = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error) })
/** Answers to commands, in order: the first that returns a result wins; every other command echoes. Cleared by the test. */
export const hostCommands: Array<(command: string) => { stdout: string; stderr?: string; exitCode?: number } | undefined> = []


/** A fake Mr. Robot app: pairs, connects, heartbeats and answers host calls (hs-xax9). */
export async function fakeHost(name = 'Desk') {
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform: 'linux' }) })
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
    Read: ({ path }) => {
      if (path === '/root/secret') return Effect.fail(new HostError({ message: 'permission denied', code: 'EACCES' }))
      const bytes = hostDisk.get(path)
      if (bytes === undefined) return Effect.succeed({ path, size: 5, text: 'hello', base64: null })
      try {
        return Effect.succeed({ path, size: bytes.length, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes), base64: null })
      } catch {
        return Effect.succeed({ path, size: bytes.length, text: null, base64: btoa(String.fromCharCode(...bytes)) })
      }
    },
    Write: ({ path, text, base64 }) => Effect.sync(() => {
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
    Run: ({ command }) => Effect.sync(() => {
      ran.push(command)
      const scripted = hostCommands.map((answer) => answer(command)).find((answer) => answer !== undefined)
      return { stdout: scripted?.stdout ?? `ran: ${command}`, stderr: scripted?.stderr ?? '', exitCode: scripted?.exitCode ?? 0, timedOut: false }
    }),
    BrowserOpen: () => Effect.fail(new HostError({ message: 'no Chrome in the fake host' })),
    BrowserClose: () => Effect.void,
  })
  const host = serveHost(handlers, (text) => socket.send(text))
  socket.addEventListener('message', (event) => {
    const parsed = parseFrame(String(event.data))
    if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
  })
  Effect.runFork(host.server)
  socket.send(frame({ t: 'hb', d: { version: '0.1.0', platform: 'linux', hostname: 'desk', capabilities: { graphical: true, chrome: '/usr/bin/google-chrome' } } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { hostId: paired.hostId, token: paired.token, socket, closes, connect }
}

/** Close the sockets of the fake hosts a test opened. */
export async function closeHosts(): Promise<void> {
  for (const socket of open.splice(0)) {
    try { socket.close(1000) } catch { /* closed */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
}
