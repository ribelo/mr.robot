/**
 * The places of a Robot (v1.16 ticket 01, ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7): one capability for run, the file tools, copy and the job
 * tools. A call names its place with `on`; this service checks the name against the Robot's grants before anything else, then dispatches to
 * the filesystem backend of the place (files.ts) or to the jobs of the place (jobs.ts). A later ticket that gives a place new powers (a Host
 * through DSH, files without limit) changes its backend, not the tools.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { HostView } from '@mr-robot/protocol'
import { COPY_CHUNK_BYTES, COPY_MAX_BYTES } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import { waitingResult, type GrantItem, type ToolCallRequest, type WaitingResult } from '../agent/ask-gate.ts'
import type { BoxBackend } from '../box/backend.ts'
import { MEMBER_FILE_NAMES } from '../member/member.ts'
import { isDocsPath } from '../docs/index.ts'
import { workspacePrefix } from '../workspace/workspace.ts'
import { bytesOfBase64, BoxFiles, boxPath, BOX_ROOT, HostFiles, WorkspaceFiles, type BoxAccess, type HostFileLink, type PlaceFiles } from './files.ts'
import type { HostCommandResult } from './host-runner.ts'
import { Jobs, type JobEntry, type JobPlace, type RunResult } from './jobs.ts'
import { BOX_PLACE, OWNED_ON_WORKSPACE, ownedPath, parseOn, placeName, WORKSPACE_PLACE, type Place, type PlaceFacet, type StoredPlace } from './place.ts'

/** One Host as the Robot reaches it: the Host RPCs, each failing as a Host call fails (offline, refused, an OS error). */
export interface HostLink extends HostFileLink {
  readChunk(input: { path: string; offset: number; length: number }): Promise<{ readonly path: string; readonly size: number; readonly base64: string }>
  writeChunk(input: { path: string; offset: number; base64: string }): Promise<{ readonly path: string; readonly bytes: number }>
  /** The copy as a whole is one line in the Host's log. */
  recordCopy(detail: string, outcome: string): Promise<void>
  /** One command through the Host's shell and sandbox, under the shell facet; `escalated` is a call the owner approved to run without the sandbox. */
  run(command: string, cwd: string | undefined, timeoutMs: number, escalated: boolean): Promise<HostCommandResult>
}

export interface PlacesDeps {
  readonly workspace: WorkspaceHost
  readonly bucket: R2Bucket
  readonly robotId: () => string
  /** Whether the Robot may use a tool group now: allow or ask, and the Home has the plugin on. */
  groupUsable(group: 'files' | 'box'): boolean
  hostUsable(hostId: string, facet: PlaceFacet): boolean
  /** The Hosts the Robot's owner reaches. */
  hosts(): Promise<readonly HostView[]>
  readonly box: BoxAccess
  link(host: HostView): HostLink
  /** The jobs of a place; `escalated` makes a Host command run without the sandbox. */
  jobPlace(place: Exclude<Place, { kind: 'workspace' }>, escalated: boolean): JobPlace
  /** The one-call Ask of a run with escalate (ob-ifak): the owner's approval runs the same call again, and only then is it approved. */
  readonly escalation: {
    approved(callId: string): boolean
    ask(request: ToolCallRequest, exec: ToolRunContext): { readonly askId: string }
  }
  readonly jobs: Jobs
}

export interface CopyEnd {
  readonly on: string
  readonly path: string
}

export interface CopyResult {
  readonly from: CopyEnd
  readonly to: CopyEnd
  readonly bytes: number
  readonly ms: number
}

export interface RunInput {
  readonly on: string
  readonly command: string
  readonly cwd?: string
  readonly seconds: number
  readonly background: boolean
  /** Run without the sandbox, once, after the owner approves (ob-ifak). Needs a reason. */
  readonly escalate: boolean
  readonly reason?: string
}

/** The largest file copy moves between the Workspace and the Box until files go straight to R2 (ticket 06). */
export const BOX_COPY_MAX_BYTES = 32 * 1024 * 1024

const ownedKey = (key: string): boolean => (MEMBER_FILE_NAMES as readonly string[]).includes(key) || isDocsPath(key)

const noGrant = (on: string, what: string, grant: string): Error =>
  new Error(`on "${on}": you hold no grant on ${what} (${grant}). Your owner can give it: propose it with propose_grants.`)

/** The arguments of a run as the tool takes them, to store the call an Ask asks about. */
const runArguments = (input: RunInput): Record<string, unknown> => ({
  on: input.on, command: input.command, ...(input.cwd === undefined ? {} : { cwd: input.cwd }), timeout_seconds: input.seconds, run_in_background: input.background, escalate: true, reason: input.reason,
})

export class Places {
  private readonly workspaceFiles: WorkspaceFiles

  constructor(private readonly deps: PlacesDeps) {
    this.workspaceFiles = new WorkspaceFiles(deps.workspace)
  }

  /** The place a call names, after the Robot's grants allowed it (allow or ask: an ask is the ask gate's to put to the owner). */
  async resolve(on: string, facet: PlaceFacet, tool: string): Promise<Place> {
    const name = parseOn(on, tool)
    if (name === WORKSPACE_PLACE) {
      if (facet === 'shell') throw new Error(`on "workspace": the Workspace holds files, it runs no commands. Run on "box" or on one of your owner's computers.`)
      if (!this.deps.groupUsable('files')) throw noGrant(name, 'your Workspace files', 'the tool group "files"')
      return { kind: 'workspace' }
    }
    if (name === BOX_PLACE) {
      if (!this.deps.groupUsable('box')) throw noGrant(name, 'your Box', 'the tool group "box"')
      return { kind: 'box' }
    }
    const host = await this.hostNamed(name)
    if (!this.deps.hostUsable(host.id, facet)) throw noGrant(name, `the ${facet} of ${host.name}`, `the grant "${host.name} · ${facet}"`)
    return { kind: 'host', id: host.id, name: host.name }
  }

  /** A Host the Robot names, by name or id, among those its owner reaches. */
  private async hostNamed(name: string): Promise<HostView> {
    const hosts = await this.deps.hosts()
    const found = hosts.find((host) => host.id === name) ?? hosts.find((host) => host.name.toLowerCase() === name.toLowerCase())
    if (found === undefined) throw new Error(`on "${name}": there is no such place. Use workspace, box or one of your owner's computers: ${hosts.length === 0 ? 'none are paired' : hosts.map((host) => host.name).join(', ')}.`)
    return found
  }

  private hostFiles(place: Extract<Place, { kind: 'host' }>, hosts: readonly HostView[]): PlaceFiles {
    const host = hosts.find((entry) => entry.id === place.id)!
    return new HostFiles(this.deps.link(host))
  }

  /** The filesystem backend of a place, for a file tool (the files facet of a Host, the box grant, the files group). */
  async files(on: string, tool: string): Promise<PlaceFiles> {
    const place = await this.resolve(on, 'files', tool)
    return place.kind === 'workspace' ? this.workspaceFiles : place.kind === 'box' ? new BoxFiles(this.deps.box) : this.hostFiles(place, await this.deps.hosts())
  }

  // ---------------------------------------------------------------- run and jobs

  async run(input: RunInput, exec: ToolRunContext): Promise<RunResult | WaitingResult> {
    const place = await this.resolve(input.on, 'shell', 'run')
    if (place.kind === 'workspace') throw new Error('run: the Workspace runs no commands')
    const cwd = input.cwd === undefined ? undefined : place.kind === 'box' ? boxPath(input.cwd) : input.cwd
    let escalated = false
    if (input.escalate) {
      if (place.kind !== 'host') throw new Error('run: escalate lifts the sandbox of a computer. Your Box has none to lift: it is yours.')
      escalated = this.deps.escalation.approved(String(exec.callId))
      if (!escalated) {
        const reason = input.reason?.trim() ?? ''
        if (reason === '') throw new Error('run: escalate needs a reason: your owner reads it before they approve the call.')
        const items: GrantItem[] = [{ kind: 'host', name: `${place.id}:shell` }]
        const { askId } = this.deps.escalation.ask({ tool: 'run', arguments: runArguments(input), reason, items }, exec)
        return waitingResult(askId, 'run')
      }
    }
    return this.deps.jobs.run(this.deps.jobPlace(place, escalated), input.command, cwd, input.seconds, input.background, exec.signal)
  }

  /** The place a job runs in must still be one the Robot may use; the ask gate asks about it by the same place. */
  private async jobPlace(id: string, tool: string): Promise<void> {
    const stored: StoredPlace | undefined = this.deps.jobs.placeOfJob(id)
    if (stored === undefined) return
    await this.resolve(stored === 'box' ? BOX_PLACE : stored.slice('host:'.length), 'shell', tool)
  }

  jobList(): JobEntry[] {
    return this.deps.jobs.list()
  }

  async jobOutput(id: string, wait: boolean, timeoutMs: number) {
    await this.jobPlace(id, 'job_output')
    return this.deps.jobs.output(id, wait, timeoutMs)
  }

  async jobKill(id: string) {
    await this.jobPlace(id, 'job_kill')
    return this.deps.jobs.kill(id)
  }

  // ---------------------------------------------------------------- copy

  /**
   * Copy one file between two places, as it is (binary too), the content never passing through the model. The Workspace, the Box and a
   * Host reach each other as the table says; a copy between two Hosts, or the Box and a Host, is not yet one call.
   */
  async copy(from: CopyEnd, to: CopyEnd): Promise<CopyResult> {
    const started = Date.now()
    const source = await this.resolve(from.on, 'files', 'copy')
    const target = await this.resolve(to.on, 'files', 'copy')
    const pair = `${source.kind}>${target.kind}`
    if (pair === 'host>host' || pair === 'host>box' || pair === 'box>host') {
      throw new Error(`copy: ${placeName(source)} to ${placeName(target)} is not one call yet. Copy the file to "workspace" first, then from there to ${placeName(target)}.`)
    }
    const host = source.kind === 'host' ? source : target.kind === 'host' ? target : undefined
    const link = host === undefined ? undefined : this.deps.link((await this.deps.hosts()).find((entry) => entry.id === host.id)!)
    const detail = `${from.path} → ${to.path}`
    try {
      const done = await this.transfer(source, target, from.path, to.path, link)
      await link?.recordCopy(detail, 'done')
      return { from: { on: placeName(source), path: done.from }, to: { on: placeName(target), path: done.to }, bytes: done.bytes, ms: Date.now() - started }
    } catch (error) {
      await link?.recordCopy(detail, error instanceof Error ? error.message : String(error)).catch(() => undefined)
      throw error
    }
  }

  private async transfer(source: Place, target: Place, fromPath: string, toPath: string, link: HostLink | undefined): Promise<{ from: string; to: string; bytes: number }> {
    if (source.kind === 'host') return this.hostToWorkspace(link!, fromPath, target.kind === 'workspace' ? toPath : '')
    if (target.kind === 'host') return this.workspaceToHost(link!, fromPath, toPath)
    if (source.kind === 'workspace' && target.kind === 'workspace') return this.workspaceToWorkspace(fromPath, toPath)
    const bytes = await this.read(source, fromPath)
    await this.write(target, toPath, bytes)
    return { from: source.kind === 'box' ? boxPath(fromPath) : `/workspace/${this.workspaceFiles.key(fromPath)}`, to: target.kind === 'box' ? boxPath(toPath) : `/workspace/${this.workspaceFiles.key(toPath)}`, bytes: bytes.byteLength }
  }

  /** A file of the Workspace or the Box, whole (at most BOX_COPY_MAX_BYTES while the Box is one of the ends). */
  private async read(place: Exclude<Place, { kind: 'host' }>, path: string): Promise<Uint8Array> {
    if (place.kind === 'box') {
      const target = boxPath(path)
      if (ownedPath(path)) throw new Error(OWNED_ON_WORKSPACE(path))
      const backend = await this.deps.box.boot()
      try {
        const size = Number((await backend.run(`stat -c %s "${target}"`, BOX_ROOT, 10).catch(() => ({ stdout: '' }))).stdout.trim())
        if (size > BOX_COPY_MAX_BYTES) throw new Error(`copy: ${target} is ${size} bytes; copies to and from the Box are limited to ${BOX_COPY_MAX_BYTES / 1024 / 1024} MB for now.`)
        const bytes = await backend.read(target)
        if (bytes === null) throw new Error(`copy: ${target} does not exist on your Box`)
        return bytes
      } finally {
        await this.deps.box.touch()
      }
    }
    return this.workspaceFiles.readFileBytes(this.workspaceFiles.key(path), BOX_COPY_MAX_BYTES)
  }

  /** Inside the Workspace the file streams from R2 to R2; an owner's file or a doc is text and goes through memory. */
  private async workspaceToWorkspace(fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const from = this.workspaceFiles.key(fromPath)
    const to = this.workspaceFiles.writableKey(toPath)
    const prefix = workspacePrefix(this.deps.robotId())
    const object = ownedKey(from) ? null : await this.deps.bucket.get(`${prefix}${from}`)
    if (object === null) {
      const bytes = await this.workspaceFiles.readFileBytes(from, BOX_COPY_MAX_BYTES)
      await this.deps.workspace.run(this.deps.workspace.workspace.write(to, bytes))
      return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: bytes.byteLength }
    }
    const fixed = new FixedLengthStream(object.size)
    const writing = this.deps.workspace.run(this.deps.workspace.workspace.write(to, fixed.readable))
    await object.body.pipeTo(fixed.writable)
    await writing
    return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: object.size }
  }

  private async write(place: Exclude<Place, { kind: 'host' }>, path: string, bytes: Uint8Array): Promise<void> {
    if (place.kind === 'box') {
      if (ownedPath(path)) throw new Error(OWNED_ON_WORKSPACE(path))
      const target = boxPath(path)
      const backend: BoxBackend = await this.deps.box.boot()
      try {
        await backend.write(target, bytes)
      } finally {
        await this.deps.box.touch()
      }
      return
    }
    await this.deps.workspace.run(this.deps.workspace.workspace.write(this.workspaceFiles.writableKey(path), bytes))
  }

  /** A Host file into the Workspace in pieces (v1.15 ticket 09): at most one piece is held, and the Workspace file is streamed to R2. */
  private async hostToWorkspace(link: HostLink, hostPath: string, workspacePath: string): Promise<{ from: string; to: string; bytes: number }> {
    const key = this.workspaceFiles.writableKey(workspacePath)
    const first = await link.readChunk({ path: hostPath, offset: 0, length: COPY_CHUNK_BYTES })
    if (first.size > COPY_MAX_BYTES) throw new Error(`copy: ${first.path} is ${first.size} bytes; files over ${COPY_MAX_BYTES / 1024 / 1024} MB are not copied. Cut it on the computer first.`)
    const fixed = new FixedLengthStream(first.size)
    const writing = this.deps.workspace.run(this.deps.workspace.workspace.write(key, fixed.readable))
    const writer = fixed.writable.getWriter()
    try {
      let offset = 0
      let chunk = first
      for (;;) {
        const bytes = bytesOfBase64(chunk.base64)
        if (bytes.length === 0 && offset < first.size) throw new Error(`copy: ${first.path} changed while it was copied`)
        if (bytes.length > 0) await writer.write(bytes)
        offset += bytes.length
        if (offset >= first.size) break
        chunk = await link.readChunk({ path: hostPath, offset, length: COPY_CHUNK_BYTES })
      }
      await writer.close()
    } catch (error) {
      await writer.abort(error).catch(() => undefined)
      await writing.catch(() => undefined)
      throw error
    }
    await writing
    return { from: first.path, to: `/workspace/${key}`, bytes: first.size }
  }

  /** A Workspace file onto a Host in pieces. */
  private async workspaceToHost(link: HostLink, workspacePath: string, hostPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const key = this.workspaceFiles.key(workspacePath)
    const object = await this.deps.bucket.head(`${workspacePrefix(this.deps.robotId())}${key}`)
    if (object === null) throw new Error(`copy: no file "${key}" in your Workspace`)
    if (object.size > COPY_MAX_BYTES) throw new Error(`copy: ${key} is ${object.size} bytes; files over ${COPY_MAX_BYTES / 1024 / 1024} MB are not copied.`)
    let offset = 0
    let written = hostPath
    do {
      const length = Math.min(COPY_CHUNK_BYTES, object.size - offset)
      const body = length === 0 ? new Uint8Array() : new Uint8Array(await (await this.deps.bucket.get(`${workspacePrefix(this.deps.robotId())}${key}`, { range: { offset, length } }))!.arrayBuffer())
      let binary = ''
      for (let at = 0; at < body.length; at += 0x8000) binary += String.fromCharCode(...body.subarray(at, at + 0x8000))
      const result = await link.writeChunk({ path: hostPath, offset, base64: btoa(binary) })
      written = result.path
      offset += body.length
    } while (offset < object.size)
    return { from: `/workspace/${key}`, to: written, bytes: object.size }
  }
}

