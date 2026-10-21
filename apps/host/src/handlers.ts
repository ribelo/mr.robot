/**
 * What the host does for robots (hs-n34u, hs-i785): files (files.ts) and a shell through DSH (shell.ts) as the signed-in user, and
 * browser sessions relayed between Mr. Robot and the host's Chrome (hs-mqwd).
 */
import * as Effect from 'effect/Effect'
import { downloadFile, HostError, HostRpcs, uploadFile, type CopyIo, type HostAccess } from '@mr-robot/host-protocol'
import { resolve } from 'node:path'
import { workspaceContext } from './workspace-context.ts'
import WebSocket from 'ws'
import type { HostChrome } from './chrome.ts'
import { fileSize, nodeCopyIo, sourceFile, type HostDownloads } from './copy.ts'
import { HostDisk } from './files.ts'
import type { HostShell } from './shell.ts'

const fail = (error: unknown) => new HostError({ message: error instanceof Error ? error.message : String(error), ...(typeof (error as { code?: unknown }).code === 'string' ? { code: (error as { code: string }).code } : {}) })

/** The directory a Workspace call works in: its current directory, else the Workspace's root. */
const where = (access: HostAccess): string => access.cwd ?? access.workspace?.root ?? '.'

export interface Relay {
  readonly hostId: string
  readonly token: string
}

/** The handlers of one connection; `downloads` outlives it, so that a copy goes on over the next connection of the same run of the app. */
export function hostHandlers(shell: HostShell, downloads: HostDownloads, chrome: HostChrome, relay: () => Relay, onSessions: (count: number) => void, copyIo: CopyIo = nodeCopyIo) {
  const disk = new HostDisk(shell, downloads)
  const sessions = new Map<string, { remote: WebSocket; local: WebSocket }>()
  const closeSession = (session: string) => {
    const found = sessions.get(session)
    sessions.delete(session)
    found?.remote.close()
    found?.local.close()
    onSessions(sessions.size)
  }
  const context = async (access: HostAccess, known: Readonly<Record<string, string>> | null, skillsDigest: string | null) => {
    const workspace = access.workspace
    if (workspace === undefined) throw Object.assign(new Error('This call names no Workspace.'), { code: 'ENOENT' })
    const session = await shell.sessions.touch(access.robot, workspace)
    return workspaceContext({ home: shell.home, repository: workspace.repository, cwd: where(access), touched: [...(session?.touched ?? [])], known, skillsDigest, skills: shell.skills })
  }
  return HostRpcs.toLayer({
    Read: ({ path, access }) => Effect.tryPromise({ try: () => disk.read(access, path), catch: fail }),
    Write: ({ path, text, base64, access, expectedHash, id }) => Effect.tryPromise({ try: () => disk.write(access, path, { text, base64, expectedHash, id }), catch: fail }),
    // Copy (v1.16): the file goes to and from R2 over presigned URLs, in parts, retried (copy.ts, the protocol's copy engine). A download writes, so it runs in the sandbox of the mode and roots.
    // The signal ends when the Worker gives up on the call or the connection is lost: the requests in flight and the writes stop (deep review P12).
    CopyStat: ({ path, access }) => Effect.tryPromise({
      try: async () => {
        const full = await disk.readable(access, path)
        return { path: full, size: await fileSize(full) }
      },
      catch: fail,
    }),
    Upload: ({ path, size, parts, access }) => Effect.tryPromise({
      try: async (signal) => {
        const full = await disk.readable(access, path)
        return { path: full, size, etags: await uploadFile(sourceFile(full), size, parts, copyIo, signal) }
      },
      catch: fail,
    }),
    Download: ({ copy, path, url, size, partBytes, from, until, access }) => Effect.tryPromise({
      try: async (signal) => {
        const target = await disk.target(access, path, { copy, first: from === 0 }, signal)
        return { path: target.path, bytes: await downloadFile(target.file, { url, size, partBytes, from, until }, copyIo, signal) }
      },
      catch: fail,
    }),
    Glob: ({ pattern, access }) => Effect.tryPromise({ try: () => disk.glob(access, pattern), catch: fail }),
    Grep: ({ pattern, ignoreCase, glob, path, access }) => Effect.tryPromise({ try: () => disk.grep(access, { pattern, ignoreCase, glob, path }), catch: fail }),
    Delete: ({ path, access }) => Effect.tryPromise({ try: () => disk.remove(access, path), catch: fail }),
    // The signal ends when the connection to the Worker is lost: a command the call was still waiting for then goes on as a job.
    Run: ({ command, cwd, timeoutMs, background, job, access }) => Effect.tryPromise({ try: (signal) => shell.run({ command, cwd, timeoutMs, background, job, access, signal }), catch: fail }),
    JobList: ({ robot }) => Effect.try({ try: () => ({ jobs: shell.jobs.list(robot) }), catch: fail }),
    JobOutput: ({ job, stream, offset }) => Effect.tryPromise({ try: () => shell.jobs.output(job, stream, offset), catch: fail }),
    JobKill: ({ job }) => Effect.try({ try: () => ({ outcome: shell.jobs.stop(job) }), catch: fail }),
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
    // The Workspace (v1.21): the picker's listing and check are reads, as wide as the OS user; a session closes when the Worker says so.
    ListDirectory: ({ path }) => Effect.tryPromise({ try: () => disk.listDirectory(path), catch: fail }),
    Stat: ({ path }) => Effect.tryPromise({ try: () => disk.stat(path), catch: fail }),
    WorkspaceClose: ({ robot }) => Effect.tryPromise({ try: () => shell.sessions.close(robot), catch: fail }),
    WorkingDirectory: ({ cd, access }) => Effect.tryPromise({ try: () => disk.workingDirectory(access, cd), catch: fail }),
    // The Workspace's instructions and skills (v1.21 ticket 04): Open renders the whole chain, State answers what changed.
    WorkspaceOpen: ({ access, skillsDigest }) => Effect.tryPromise({ try: () => context(access, null, skillsDigest), catch: fail }),
    WorkspaceState: ({ access, known, skillsDigest }) => Effect.tryPromise({ try: () => context(access, known, skillsDigest), catch: fail }),
    CreateWorktree: ({ access }) => Effect.tryPromise({ try: () => shell.createWorktree(access), catch: fail }),
    // Language servers (ticket 06): the Workspace's session owns them; the root is the worktree when there is one.
    Lsp: ({ operation, file, line, character, access }) => Effect.tryPromise({
      try: async (signal) => {
        const workspace = access.workspace
        const session = await shell.sessions.touch(access.robot, workspace)
        if (workspace === undefined || session === undefined) throw Object.assign(new Error('lsp works in a Workspace only.'), { code: 'ENOENT' })
        return shell.languageServers.query(session, workspace.worktree ?? workspace.root, { operation, file: resolve(where(access), file), line, character }, signal)
      },
      catch: fail,
    }),
    SkillLoad: ({ name, access }) => Effect.tryPromise({
      try: async () => {
        const loaded = await shell.skills.load(where(access), name)
        if (loaded === undefined) throw Object.assign(new Error(`there is no skill "${name}" on this computer for your Workspace`), { code: 'ENOENT' })
        return loaded
      },
      catch: fail,
    }),
  })
}
