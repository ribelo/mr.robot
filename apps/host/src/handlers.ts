/**
 * What the host does for robots (hs-n34u, hs-i785): files and a shell as the signed-in user, and
 * browser sessions relayed between Mr. Robot and the host's Chrome (hs-mqwd).
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import * as Effect from 'effect/Effect'
import { HostError, HostRpcs } from '@mr-robot/host-protocol'
import WebSocket from 'ws'
import type { HostChrome } from './chrome.ts'

const MAX_READ = 10 * 1024 * 1024
const MAX_OUTPUT = 1024 * 1024

const resolve = (path: string) => (isAbsolute(path) ? path : join(homedir(), path.replace(/^~\/?/, '')))
const fail = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error), ...(typeof (error as { code?: unknown }).code === 'string' ? { code: (error as { code: string }).code } : {}) })

export interface Relay {
  readonly hostId: string
  readonly token: string
}

export function hostHandlers(chrome: HostChrome, relay: () => Relay, onSessions: (count: number) => void) {
  const sessions = new Map<string, { remote: WebSocket; local: WebSocket }>()
  const closeSession = (session: string) => {
    const found = sessions.get(session)
    sessions.delete(session)
    found?.remote.close()
    found?.local.close()
    onSessions(sessions.size)
  }
  return HostRpcs.toLayer({
    Read: ({ path }) => Effect.tryPromise({
      try: async () => {
        const full = resolve(path)
        const info = await stat(full)
        if (info.size > MAX_READ) throw Object.assign(new Error(`${full} is ${info.size} bytes; files over 10 MB are not read`), { code: 'EFBIG' })
        const body = await readFile(full)
        try {
          return { path: full, size: body.length, text: new TextDecoder('utf-8', { fatal: true }).decode(body), base64: null }
        } catch {
          return { path: full, size: body.length, text: null, base64: body.toString('base64') }
        }
      },
      catch: fail,
    }),
    Write: ({ path, text, base64 }) => Effect.tryPromise({
      try: async () => {
        const full = resolve(path)
        const body = base64 !== undefined ? Buffer.from(base64, 'base64') : Buffer.from(text ?? '', 'utf8')
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, body)
        return { path: full, bytes: body.length }
      },
      catch: fail,
    }),
    Run: ({ command, cwd, timeoutMs }) => Effect.tryPromise({
      try: () => new Promise((done, reject) => {
        // The user's login shell, so their PATH and environment apply (Leash included).
        const shell = process.env.SHELL || '/bin/sh'
        const child = spawn(shell, ['-lc', command], { cwd: cwd === undefined ? homedir() : resolve(cwd), env: process.env })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString() })
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, Math.min(timeoutMs ?? 120_000, 600_000))
        child.on('error', (error) => { clearTimeout(timer); reject(error) })
        child.on('close', (code) => {
          clearTimeout(timer)
          done({ stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT), exitCode: code, timedOut })
        })
      }),
      catch: fail,
    }) as Effect.Effect<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }, HostError>,
    BrowserOpen: ({ session, relayUrl }) => Effect.tryPromise({
      try: async () => {
        const endpoint = await chrome.devtools()
        const { hostId, token } = relay()
        const remoteUrl = relayUrl.replace(/^http/, 'ws')
        const open = (socket: WebSocket) => new Promise<void>((done, reject) => { socket.once('open', () => done()); socket.once('error', reject) })
        const local = new WebSocket(endpoint, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
        await open(local)
        const remote = new WebSocket(remoteUrl, { headers: { authorization: `Bearer ${token}`, 'x-host-id': hostId }, maxPayload: 256 * 1024 * 1024 })
        await open(remote)
        // DevTools messages flow both ways unchanged.
        local.on('message', (data, binary) => { if (remote.readyState === WebSocket.OPEN) remote.send(binary ? data : data.toString()) })
        remote.on('message', (data, binary) => { if (local.readyState === WebSocket.OPEN) local.send(binary ? data : data.toString()) })
        local.on('close', () => closeSession(session))
        remote.on('close', () => closeSession(session))
        sessions.set(session, { remote, local })
        onSessions(sessions.size)
        return { browser: endpoint.split('/devtools/')[0] ?? 'chrome' }
      },
      catch: fail,
    }),
    BrowserClose: ({ session }) => Effect.sync(() => closeSession(session)),
  })
}
