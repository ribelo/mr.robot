/**
 * The places of a Robot (v1.16 ticket 01, ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7): one capability for run, the file tools, copy and the job
 * tools. A call names its place with `on`; this service checks the name against the Robot's grants before anything else, then dispatches to
 * the filesystem backend of the place (files.ts) or to the jobs of the place (jobs.ts). A later ticket that gives a place new powers (a Host
 * through DSH, files without limit) changes its backend, not the tools.
 */
import type { HostView } from '@mr-robot/protocol'
import { copyTimeoutMs, type UploadPart } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import type { BoxBackend } from '../box/backend.ts'
import { workspacePrefix } from '../workspace/workspace.ts'
import { shellQuote } from './file-ops.ts'
import { BoxFiles, boxPath, BOX_ROOT, HostFiles, WorkspaceFiles, type BoxAccess, type HostFileLink, type PlaceFiles } from './files.ts'
import type { Transfer, Transfers } from './transfers.ts'
import type { HostCommandResult } from './host-runner.ts'
import { Jobs, type JobEntry, type JobPlace, type RunResult } from './jobs.ts'
import { BOX_PLACE, OWNED_ON_WORKSPACE, ownedPath, parseOn, placeName, WORKSPACE_PLACE, type Place, type PlaceFacet, type StoredPlace } from './place.ts'

/** One Host as the Robot reaches it: the v1.2 RPCs, each failing as a Host call fails (offline, refused, an OS error). */
export interface HostLink extends HostFileLink {
  /** The size of a file on the Host, so that the Worker can plan an upload. */
  copySize(path: string): Promise<{ readonly path: string; readonly size: number }>
  /** The Host app puts the file to R2, part by part, over the presigned URLs. */
  upload(input: { path: string; size: number; parts: readonly UploadPart[] }): Promise<{ readonly path: string; readonly size: number; readonly etags: ReadonlyArray<{ readonly number: number; readonly etag: string }> }>
  /** The Host app fetches an object from R2 into a file, range by range. */
  download(input: { path: string; url: string; size: number; partBytes: number }): Promise<{ readonly path: string; readonly bytes: number }>
  /** The copy as a whole is one line in the Host's log. */
  recordCopy(detail: string, outcome: string): Promise<void>
  /** One command in the Host's login shell, under the shell facet. */
  run(command: string, cwd: string | undefined, timeoutMs: number): Promise<HostCommandResult>
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
  /** The jobs of a place. */
  jobPlace(place: Exclude<Place, { kind: 'workspace' }>): JobPlace
  readonly jobs: Jobs
  /** The Robot's Workspace as presigned URLs: how a file reaches a Host without the Worker in the pipe. */
  readonly transfers: Transfers
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
  /** The size and time in words, for the Robot and the Trajectory: "2.1 GB in 41 s". */
  readonly took: string
}

/** A size in words, in powers of 1024. */
export function sizeWords(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return unit === 0 ? `${bytes} bytes` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

/** A duration in words: "850 ms", "41 s", "3 min 5 s". */
export function durationWords(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export interface RunInput {
  readonly on: string
  readonly command: string
  readonly cwd?: string
  readonly seconds: number
  readonly background: boolean
}

/** Where a copy that has two Hosts or a Host and the Box as its ends parks the file: tmp/<id>/ in the Workspace, deleted when the copy ends. */
const stagingDirectory = (): string => `tmp/${crypto.randomUUID()}`

const noGrant = (on: string, what: string, grant: string): Error =>
  new Error(`on "${on}": you hold no grant on ${what} (${grant}). Your owner can give it: propose it with propose_grants.`)

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

  async run(input: RunInput, signal?: AbortSignal): Promise<RunResult> {
    const place = await this.resolve(input.on, 'shell', 'run')
    if (place.kind === 'workspace') throw new Error('run: the Workspace runs no commands')
    const cwd = input.cwd === undefined ? undefined : place.kind === 'box' ? boxPath(input.cwd) : input.cwd
    return this.deps.jobs.run(this.deps.jobPlace(place), input.command, cwd, input.seconds, input.background, signal)
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
   * Copy one file between two places, as it is (binary too), the content never passing through the model or the Worker. A Host and the
   * Workspace exchange it through presigned R2 URLs; the Box and the Workspace through ws inside the Box; inside the Workspace R2 copies it;
   * two Hosts, or the Box and a Host, stage it in the Workspace under tmp/ and delete it after (ob-d3rt, ob-qshq, ob-fgyk, ob-qr7v).
   */
  async copy(from: CopyEnd, to: CopyEnd): Promise<CopyResult> {
    const started = Date.now()
    const source = await this.resolve(from.on, 'files', 'copy')
    const target = await this.resolve(to.on, 'files', 'copy')
    const hosts = await this.deps.hosts()
    const links = [source, target].flatMap((place) => place.kind === 'host' ? [this.deps.link(hosts.find((entry) => entry.id === place.id)!)] : [])
    const detail = `${from.path} → ${to.path}`
    try {
      const done = await this.transfer(source, target, from.path, to.path)
      await Promise.all(links.map((link) => link.recordCopy(detail, 'done')))
      const ms = Date.now() - started
      return { from: { on: placeName(source), path: done.from }, to: { on: placeName(target), path: done.to }, bytes: done.bytes, ms, took: `${sizeWords(done.bytes)} in ${durationWords(ms)}` }
    } catch (error) {
      await Promise.all(links.map((link) => link.recordCopy(detail, error instanceof Error ? error.message : String(error)).catch(() => undefined)))
      throw error
    }
  }

  private linkOf(place: Extract<Place, { kind: 'host' }>, hosts: readonly HostView[]): HostLink {
    return this.deps.link(hosts.find((entry) => entry.id === place.id)!)
  }

  private async transfer(source: Place, target: Place, fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    if (source.kind === 'workspace' && target.kind === 'workspace') return this.workspaceToWorkspace(fromPath, toPath)
    if (source.kind === 'host' && target.kind === 'workspace') return this.hostToWorkspace(this.linkOf(source, await this.deps.hosts()), fromPath, toPath)
    if (source.kind === 'workspace' && target.kind === 'host') return this.workspaceToHost(this.linkOf(target, await this.deps.hosts()), fromPath, toPath)
    if (source.kind === 'workspace' && target.kind === 'box') return this.workspaceToBox(fromPath, toPath)
    if (source.kind === 'box' && target.kind === 'workspace') return this.boxToWorkspace(fromPath, toPath)
    return this.staged(source, target, fromPath, toPath)
  }

  /** Two Hosts, or the Box and a Host: the file goes to the Workspace first and from there on; the staged copy is deleted whatever happens. */
  private async staged(source: Place, target: Place, fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const directory = stagingDirectory()
    const parked = `${directory}/file`
    try {
      const first = await this.transfer(source, { kind: 'workspace' }, fromPath, parked)
      const second = await this.transfer({ kind: 'workspace' }, target, parked, toPath)
      return { from: first.from, to: second.to, bytes: second.bytes }
    } finally {
      await this.deps.transfers.removeStaged(directory).catch((error: unknown) => console.warn('staged copy not removed', error))
    }
  }

  /** What a failed transfer says, as the Robot reads it. */
  private ok<A>(result: Transfer<A>): A {
    if (!result.ok) throw new Error(`copy: ${result.error}`)
    return result.value
  }

  /** Inside the Workspace the file streams from R2 to R2; an owner's file or a doc is text and goes through memory. */
  private async workspaceToWorkspace(fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const from = this.workspaceFiles.key(fromPath)
    const to = this.workspaceFiles.writableKey(toPath)
    const prefix = workspacePrefix(this.deps.robotId())
    const owned = await this.workspaceFiles.owned(from)
    if (owned !== undefined) {
      await this.deps.workspace.run(this.deps.workspace.workspace.write(to, owned))
      return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: owned.byteLength }
    }
    const object = await this.deps.bucket.get(`${prefix}${from}`)
    if (object === null) throw new Error(`/workspace/${from} does not exist`)
    const fixed = new FixedLengthStream(object.size)
    const writing = this.deps.workspace.run(this.deps.workspace.workspace.write(to, fixed.readable))
    await object.body.pipeTo(fixed.writable)
    await writing
    return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: object.size }
  }

  /** ws inside the Box moves the file between the Box's disk and R2; its token and the Worker's address were written when the Box booted. */
  private async ws(backend: BoxBackend, args: string, bytes: number): Promise<void> {
    const seconds = Math.ceil(copyTimeoutMs(bytes) / 1000)
    const result = await backend.run(`ws ${args}`, BOX_ROOT, seconds)
    if (result.exitCode !== 0) throw new Error(`copy: ws ${result.exitCode === 124 ? `ran out of time (${seconds} s)` : 'failed'}: ${(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, 500)}`)
  }

  private async workspaceToBox(fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const key = this.workspaceFiles.key(fromPath)
    if (ownedPath(toPath)) throw new Error(OWNED_ON_WORKSPACE(toPath))
    const target = boxPath(toPath)
    const owned = await this.workspaceFiles.owned(key)
    const object = owned === undefined ? await this.deps.bucket.head(`${workspacePrefix(this.deps.robotId())}${key}`) : null
    if (owned === undefined && object === null) throw new Error(`copy: no file "${key}" in your Workspace`)
    const backend = await this.deps.box.boot()
    try {
      // An owner's file or a doc is a few lines of text kept in the Worker, not an object ws could fetch.
      if (owned !== undefined) await backend.write(target, owned)
      else await this.ws(backend, `get ${shellQuote(key)} ${shellQuote(target)}`, object!.size)
      return { from: `/workspace/${key}`, to: target, bytes: owned?.byteLength ?? object!.size }
    } finally {
      await this.deps.box.touch()
    }
  }

  private async boxToWorkspace(fromPath: string, toPath: string): Promise<{ from: string; to: string; bytes: number }> {
    if (ownedPath(fromPath)) throw new Error(OWNED_ON_WORKSPACE(fromPath))
    const source = boxPath(fromPath)
    const key = this.workspaceFiles.writableKey(toPath)
    const backend = await this.deps.box.boot()
    try {
      const sized = await backend.run(`stat -c %s ${shellQuote(source)}`, BOX_ROOT, 10).catch(() => ({ stdout: '', exitCode: 1 }))
      const bytes = Number(sized.stdout.trim())
      if (sized.exitCode !== 0 || !Number.isSafeInteger(bytes)) throw new Error(`copy: ${source} does not exist on your Box`)
      await this.ws(backend, `put ${shellQuote(source)} ${shellQuote(key)}`, bytes)
      return { from: source, to: `/workspace/${key}`, bytes }
    } finally {
      await this.deps.box.touch()
    }
  }

  /** A Host file into the Workspace: the Host app puts it to R2 over presigned URLs, in parts; the Worker plans the parts and completes the upload. */
  private async hostToWorkspace(link: HostLink, hostPath: string, workspacePath: string): Promise<{ from: string; to: string; bytes: number }> {
    const key = this.workspaceFiles.writableKey(workspacePath)
    const file = await link.copySize(hostPath)
    const plan = this.ok(await this.deps.transfers.upload(key, file.size))
    try {
      const sent = await link.upload({ path: hostPath, size: file.size, parts: plan.parts })
      this.ok(await this.deps.transfers.finish(key, plan.uploadId, sent.etags))
    } catch (error) {
      if (plan.uploadId !== undefined) await this.deps.transfers.abort(key, plan.uploadId).catch(() => undefined)
      throw error
    }
    return { from: file.path, to: `/workspace/${key}`, bytes: file.size }
  }

  /** A Workspace file onto a Host: the Host app fetches it from R2 over a presigned URL, range by range. */
  private async workspaceToHost(link: HostLink, workspacePath: string, hostPath: string): Promise<{ from: string; to: string; bytes: number }> {
    const key = this.workspaceFiles.key(workspacePath)
    const plan = this.ok(await this.deps.transfers.download(key))
    const received = await link.download({ path: hostPath, url: plan.url, size: plan.size, partBytes: plan.partBytes })
    return { from: `/workspace/${key}`, to: received.path, bytes: received.bytes }
  }
}
