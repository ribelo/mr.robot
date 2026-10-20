/**
 * What the host does for robots (hs-n34u, hs-i785): files (files.ts) and a shell through DSH (shell.ts) as the signed-in user, and
 * browser sessions relayed between Mr. Robot and the host's Chrome (hs-mqwd).
 */
import * as Effect from 'effect/Effect'
import { downloadFile, HostError, HostRpcs, uploadFile, type CopyIo } from '@mr-robot/host-protocol'
import WebSocket from 'ws'
import type { HostChrome } from './chrome.ts'
import { fileSize, nodeCopyIo, sourceFile, targetFile } from './copy.ts'
import { HostDisk } from './files.ts'
import type { HostShell } from './shell.ts'

const fail = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error), ...(typeof (error as { code?: unknown }).code === 'string' ? { code: (error as { code: string }).code } : {}) })

export interface Relay {
  readonly hostId: string
  readonly token: string
}

export function hostHandlers(shell: HostShell, chrome: HostChrome, relay: () => Relay, onSessions: (count: number) => void, disk = new HostDisk(), copyIo: CopyIo = nodeCopyIo) {
  const sessions = new Map<string, { remote: WebSocket; local: WebSocket }>()
  const closeSession = (session: string) => {
    const found = sessions.get(session)
    sessions.delete(session)
    found?.remote.close()
    found?.local.close()
    onSessions(sessions.size)
  }
  return HostRpcs.toLayer({
    Read: ({ path, access }) => Effect.tryPromise({ try: () => disk.read(access, path), catch: fail }),
    Write: ({ path, text, base64, access }) => Effect.tryPromise({ try: () => disk.write(access, path, { text, base64 }), catch: fail }),
    // Copy (v1.16): the file goes to and from R2 over presigned URLs, in parts, retried (copy.ts, the protocol's copy engine). A download writes, so it obeys the mode and roots.
    CopyStat: ({ path, access }) => Effect.tryPromise({
      try: async () => {
        const full = await disk.readable(access, path)
        return { path: full, size: await fileSize(full) }
      },
      catch: fail,
    }),
    Upload: ({ path, size, parts, access }) => Effect.tryPromise({
      try: async () => {
        const full = await disk.readable(access, path)
        return { path: full, size, etags: await uploadFile(sourceFile(full), size, parts, copyIo) }
      },
      catch: fail,
    }),
    Download: ({ path, url, size, partBytes, access }) => Effect.tryPromise({
      try: async () => {
        const full = await disk.writable(access, path)
        return { path: full, bytes: await downloadFile(targetFile(full), { url, size, partBytes }, copyIo) }
      },
      catch: fail,
    }),
    Glob: ({ pattern, access }) => Effect.tryPromise({ try: () => disk.glob(access, pattern), catch: fail }),
    Grep: ({ pattern, ignoreCase, glob, path, access }) => Effect.tryPromise({ try: () => disk.grep(access, { pattern, ignoreCase, glob, path }), catch: fail }),
    Delete: ({ path, access }) => Effect.tryPromise({ try: () => disk.remove(access, path), catch: fail }),
    Run: ({ command, cwd, timeoutMs, access }) => Effect.tryPromise({ try: () => shell.run({ command, cwd, timeoutMs, access }), catch: fail }),
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
