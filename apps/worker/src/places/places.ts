/**
 * The places of a Robot (v1.16 ticket 01, ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7): one capability for run, the file tools, copy and the job
 * tools. A call names its place with `on`; this service checks the name against the Robot's grants before anything else, then dispatches to
 * the filesystem backend of the place (files.ts) or to the jobs of the place (jobs.ts). A later ticket that gives a place new powers (a Host
 * through DSH, files without limit) changes its backend, not the tools.
 *
 * Refusals are tagged errors (errors.ts) thrown from here; the tool boundary words them.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { HostView } from '@mr-robot/protocol'
import { copyTimeoutMs, type UploadPart } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import { waitingResult, type GrantItem, type ToolCallRequest, type WaitingResult } from '../agent/ask-gate.ts'
import type { BoxBackend } from '../box/backend.ts'
import { BadCall, CopyRefused, MissingFile, NoGrant, UnknownPlace, WrongPlace } from './errors.ts'
import { shellQuote } from './file-ops.ts'
import { BoxFiles, boxPath, BOX_ROOT, HostFiles, ownedBytes, refuseOwnedOnHost, workspaceKey, WorkspaceFiles, writableWorkspaceKey, type BoxAccess, type HostFileLink, type PlaceFiles } from './files.ts'
import { hostFacetKey, hostIdOfPlace, type StoredPlace } from './host-facet.ts'
import type { JobId } from './job-id.ts'
import type { Transfers } from './transfers.ts'
import { Jobs, type JobEntry, type JobPlace, type JobOutputView, type KillView, type RunResult } from './jobs.ts'
import { BOX_PLACE, parseOn, placeName, refuseOwned, WORKSPACE_PLACE, type JobsPlace, type Place, type PlaceFacet, type Reach } from './place.ts'

/** One Host as the Robot reaches it: the Host RPCs, each failing as a Host call fails (offline, refused, an OS error). */
export interface HostLink extends HostFileLink {
  /** The size of a file on the Host, so that the Worker can plan an upload. */
  copySize(path: string): Promise<{ readonly path: string; readonly size: number }>
  /** The Host app puts the parts to R2 over the presigned URLs. */
  upload(input: { path: string; size: number; parts: readonly UploadPart[] }): Promise<{ readonly path: string; readonly size: number; readonly etags: ReadonlyArray<{ readonly number: number; readonly etag: string }> }>
  /** The Host app fetches the bytes from `from` to `until` of an object into a file, range by range; the file appears when `until` is the size. */
  download(input: { path: string; url: string; size: number; partBytes: number; from: number; until: number }): Promise<{ readonly path: string; readonly bytes: number }>
  /** The copy as a whole is one line in the Host's log. */
  recordCopy(detail: string, outcome: string): Promise<void>
}

export interface PlacesDeps {
  readonly workspace: WorkspaceHost
  /** Whether the Robot may use the Workspace now: the files group at allow or ask, or the Robot is in setup (its first Conversation writes its persona files). */
  workspaceUsable(): boolean
  /** Whether the Robot may use the Box now: the box group at allow or ask, and the Home has the plugin on. */
  boxUsable(): boolean
  hostUsable(hostId: string, facet: PlaceFacet): boolean
  /** The Hosts the Robot's owner reaches. */
  hosts(): Promise<readonly HostView[]>
  readonly box: BoxAccess
  link(host: HostView, reach: Reach): HostLink
  /** The jobs of a place; `reach` makes a Host command run without the sandbox when the owner approved that. */
  jobPlace(place: JobsPlace, reach: Reach): JobPlace
  /** The one-call Ask of a call with escalate (ob-ifak): the owner's approval runs the same call again, and only then is it approved. */
  readonly escalation: {
    approved(callId: string): boolean
    ask(request: ToolCallRequest, exec: ToolRunContext): { readonly askId: string }
  }
  readonly jobs: Jobs
  /** The Robot's Workspace as presigned URLs: how a file reaches a Host without the Worker in the pipe. */
  readonly transfers: Transfers
  /** How many parts of a file a Host is handed links for at once. */
  readonly windowParts: number
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

/**
 * A call that asks to run once without the sandbox (ob-ifak): the owner's reason, and the arguments exactly as the Robot gave them, which
 * the Ask stores and the platform runs again when the owner approves.
 */
export interface Escalation {
  readonly reason: string | undefined
  readonly arguments: Readonly<Record<string, unknown>>
}

export interface RunInput {
  readonly on: string
  readonly command: string
  readonly cwd?: string
  readonly seconds: number
  readonly background: boolean
  readonly escalation?: Escalation
}

/** What a file tool asks of a place: its name, the tool (for the grant it names in a refusal), and an escalation when the call asked for one. */
export interface FilesRequest {
  readonly on: string
  readonly tool: string
  readonly escalation?: Escalation
}

/** What a copy moved: both paths as the places print them, and the bytes. */
interface Moved {
  readonly from: string
  readonly to: string
  readonly bytes: number
}

/** Where a copy that has two Hosts or a Host and the Box as its ends parks the file: tmp/<id>/ in the Workspace, deleted when the copy ends. */
const stagingDirectory = (): string => `tmp/${crypto.randomUUID()}`

const noGrant = (on: string, what: string, grant: string): NoGrant =>
  new NoGrant({ on, what, grant, message: `on "${on}": you hold no grant on ${what} (${grant}). Your owner can give it: propose it with propose_grants.` })

export class Places {
  private readonly workspaceFiles: WorkspaceFiles
  /** The Workspace paths a copy in flight has opened to ws on the Box, with how many copies hold each. */
  private readonly permits = new Map<string, number>()

  constructor(private readonly deps: PlacesDeps) {
    this.workspaceFiles = new WorkspaceFiles(deps.workspace)
  }

  /**
   * The place a call names, after the Robot's grants allowed it (allow or ask: an ask is the ask gate's to put to the owner).
   * @throws NoGrant, UnknownPlace or WrongPlace.
   */
  async resolve(on: string, facet: PlaceFacet, tool: string): Promise<Place> {
    const name = parseOn(on, tool)
    if (name === WORKSPACE_PLACE) {
      if (facet === 'shell') throw new WrongPlace({ on: name, message: `on "workspace": the Workspace holds files, it runs no commands. Run on "box" or on one of your owner's computers.` })
      if (!this.deps.workspaceUsable()) throw noGrant(name, 'your Workspace files', 'the tool group "files"')
      return { kind: 'workspace' }
    }
    if (name === BOX_PLACE) {
      if (!this.deps.boxUsable()) throw noGrant(name, 'your Box', 'the tool group "box"')
      return { kind: 'box' }
    }
    const host = await this.hostNamed(name)
    if (!this.deps.hostUsable(host.id, facet)) throw noGrant(name, `the ${facet} of ${host.name}`, `the grant "${host.name} · ${facet}"`)
    return { kind: 'host', host }
  }

  /** A Host the Robot names, by name or id, among those its owner reaches. @throws UnknownPlace when there is none; a failed lookup is the Home's own error. */
  async hostNamed(name: string): Promise<HostView> {
    const hosts = await this.deps.hosts()
    const found = hosts.find((host) => host.id === name) ?? hosts.find((host) => host.name.toLowerCase() === name.toLowerCase())
    if (found === undefined) {
      const known = hosts.map((host) => host.name)
      throw new UnknownPlace({ on: name, known, message: `on "${name}": there is no such place. Use workspace, box or one of your owner's computers: ${known.length === 0 ? 'none are paired' : known.join(', ')}.` })
    }
    return found
  }

  /** The place a call to run or a job tool names. */
  private async shellPlace(on: string, tool: string): Promise<JobsPlace> {
    const place = await this.resolve(on, 'shell', tool)
    if (place.kind === 'workspace') throw new WrongPlace({ on, message: `${tool}: the Workspace runs no commands` })
    return place
  }

  private filesOf(place: Place, reach: Reach): PlaceFiles {
    return place.kind === 'workspace' ? this.workspaceFiles : place.kind === 'box' ? new BoxFiles(this.deps.box) : new HostFiles(this.deps.link(place.host, reach))
  }

  /** The filesystem backend of a place, for a call that reads (the files facet of a Host, the box grant, the files group). */
  async files(on: string, tool: string): Promise<PlaceFiles> {
    return this.filesOf(await this.resolve(on, 'files', tool), 'granted')
  }

  /**
   * Do `action` on the files of a place. A call that asked to escalate acts on a computer without the sandbox, once: the owner is asked
   * first, and the answer is the waiting result; the approved call comes back here and runs.
   */
  async withFiles<A>(request: FilesRequest, exec: ToolRunContext, action: (files: PlaceFiles) => Promise<A>): Promise<A | WaitingResult> {
    const place = await this.resolve(request.on, 'files', request.tool)
    if (request.escalation === undefined) return action(this.filesOf(place, 'granted'))
    if (place.kind !== 'host') throw new BadCall({ tool: request.tool, message: `${request.tool}: escalate lifts the sandbox of a computer. ${place.kind === 'box' ? 'Your Box has none to lift: it is yours.' : 'The Workspace has none to lift.'}` })
    const reach = this.escalate(place.host, 'files', request.tool, request.escalation, exec)
    return reach === 'escalated' ? action(this.filesOf(place, 'escalated')) : reach
  }

  /**
   * The reach of a call that asked to escalate: 'escalated' when the owner approved this very call, else the Ask is stored and the waiting
   * result is what the Robot is told.
   */
  private escalate(host: HostView, facet: PlaceFacet, tool: string, escalation: Escalation, exec: ToolRunContext): 'escalated' | WaitingResult {
    if (this.deps.escalation.approved(String(exec.callId))) return 'escalated'
    const reason = escalation.reason?.trim() ?? ''
    if (reason === '') throw new BadCall({ tool, message: `${tool}: escalate needs a reason: your owner reads it before they approve the call.` })
    const items: GrantItem[] = [{ kind: 'host', name: hostFacetKey(host.id, facet) }]
    const { askId } = this.deps.escalation.ask({ tool, arguments: escalation.arguments, reason, items }, exec)
    return waitingResult(askId, tool)
  }

  // ---------------------------------------------------------------- run and jobs

  async run(input: RunInput, exec: ToolRunContext): Promise<RunResult | WaitingResult> {
    const place = await this.shellPlace(input.on, 'run')
    const cwd = input.cwd === undefined ? undefined : place.kind === 'box' ? boxPath(input.cwd) : input.cwd
    let reach: Reach = 'granted'
    if (input.escalation !== undefined) {
      if (place.kind !== 'host') throw new BadCall({ tool: 'run', message: 'run: escalate lifts the sandbox of a computer. Your Box has none to lift: it is yours.' })
      const escalated = this.escalate(place.host, 'shell', 'run', input.escalation, exec)
      if (escalated !== 'escalated') return escalated
      reach = 'escalated'
    }
    return this.deps.jobs.run(this.deps.jobPlace(place, reach), { command: input.command, cwd, seconds: input.seconds, background: input.background }, exec.signal)
  }

  /** The place a job runs in must still be one the Robot may use; the ask gate asks about it by the same place. */
  private async jobPlace(id: JobId, tool: string): Promise<void> {
    const stored: StoredPlace | undefined = this.deps.jobs.placeOfJob(id)
    if (stored === undefined) return
    await this.shellPlace(hostIdOfPlace(stored) ?? BOX_PLACE, tool)
  }

  jobList(): JobEntry[] {
    return this.deps.jobs.list()
  }

  async jobOutput(id: JobId, wait: boolean, timeoutMs: number): Promise<JobOutputView> {
    await this.jobPlace(id, 'job_output')
    return this.deps.jobs.output(id, wait, timeoutMs)
  }

  async jobKill(id: JobId): Promise<KillView> {
    await this.jobPlace(id, 'job_kill')
    return this.deps.jobs.kill(id)
  }

  // ---------------------------------------------------------------- copy

  /**
   * Copy one file between two places, as it is (binary too), the content never passing through the model or the Worker. A Host and the
   * Workspace exchange it through presigned R2 URLs; the Box and the Workspace through ws inside the Box; inside the Workspace R2 copies it;
   * two Hosts, or the Box and a Host, stage it in the Workspace under tmp/ and delete it after (ob-d3rt, ob-qshq, ob-fgyk, ob-qr7v).
   * A copy that asked to escalate writes on its destination computer without the sandbox, once, after the owner approved.
   * @returns the waiting result when the owner is being asked.
   */
  async copy(from: CopyEnd, to: CopyEnd, exec: ToolRunContext, escalation?: Escalation): Promise<CopyResult | WaitingResult> {
    const started = Date.now()
    const source = await this.resolve(from.on, 'files', 'copy')
    const target = await this.resolve(to.on, 'files', 'copy')
    let reach: Reach = 'granted'
    if (escalation !== undefined) {
      if (target.kind !== 'host') throw new BadCall({ tool: 'copy', message: 'copy: escalate lifts the sandbox of the computer a file is written to, and the destination is not a computer.' })
      const escalated = this.escalate(target.host, 'files', 'copy', escalation, exec)
      if (escalated !== 'escalated') return escalated
      reach = 'escalated'
    }
    const links = [source, target].flatMap((place) => place.kind === 'host' ? [this.deps.link(place.host, 'granted')] : [])
    const detail = `${from.path} → ${to.path}`
    try {
      const done = await this.transfer(source, target, from.path, to.path, reach)
      await Promise.all(links.map((link) => link.recordCopy(detail, 'done')))
      const ms = Date.now() - started
      return { from: { on: placeName(source), path: done.from }, to: { on: placeName(target), path: done.to }, bytes: done.bytes, ms, took: `${sizeWords(done.bytes)} in ${durationWords(ms)}` }
    } catch (error) {
      await Promise.all(links.map((link) => link.recordCopy(detail, error instanceof Error ? error.message : String(error)).catch(() => undefined)))
      throw error
    }
  }

  private async transfer(source: Place, target: Place, fromPath: string, toPath: string, reach: Reach): Promise<Moved> {
    if (source.kind === 'workspace' && target.kind === 'workspace') return this.workspaceToWorkspace(fromPath, toPath)
    if (source.kind === 'host' && target.kind === 'workspace') return this.hostToWorkspace(this.deps.link(source.host, 'granted'), fromPath, toPath)
    if (source.kind === 'workspace' && target.kind === 'host') return this.workspaceToHost(this.deps.link(target.host, reach), fromPath, toPath)
    if (source.kind === 'workspace' && target.kind === 'box') return this.workspaceToBox(fromPath, toPath)
    if (source.kind === 'box' && target.kind === 'workspace') return this.boxToWorkspace(fromPath, toPath)
    return this.staged(source, target, fromPath, toPath, reach)
  }

  /** Two Hosts, or the Box and a Host: the file goes to the Workspace first and from there on; the staged copy is deleted whatever happens. */
  private async staged(source: Place, target: Place, fromPath: string, toPath: string, reach: Reach): Promise<Moved> {
    const directory = stagingDirectory()
    const parked = `${directory}/file`
    try {
      const first = await this.transfer(source, { kind: 'workspace' }, fromPath, parked, 'granted')
      const second = await this.transfer({ kind: 'workspace' }, target, parked, toPath, reach)
      return { from: first.from, to: second.to, bytes: second.bytes }
    } finally {
      await this.deps.transfers.removeStaged(directory).catch((error: unknown) => console.warn('staged copy not removed', error))
    }
  }

  /** Inside the Workspace the file streams from R2 to R2; an owner's file or a doc is text and goes through memory. */
  private async workspaceToWorkspace(fromPath: string, toPath: string): Promise<Moved> {
    const from = workspaceKey(fromPath)
    const to = writableWorkspaceKey(toPath)
    const { workspace, run } = this.deps.workspace
    const owned = await ownedBytes(this.deps.workspace, from)
    if (owned !== undefined) {
      await run(workspace.write(to, owned))
      return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: owned.byteLength }
    }
    const object = await run(workspace.open(from))
    if (object === undefined) throw new MissingFile({ place: 'your Workspace', path: from, message: `/workspace/${from} does not exist` })
    const fixed = new FixedLengthStream(object.size)
    const writing = run(workspace.write(to, fixed.readable))
    await object.body.pipeTo(fixed.writable)
    await writing
    return { from: `/workspace/${from}`, to: `/workspace/${to}`, bytes: object.size }
  }

  /** Whether a copy in flight has opened this Workspace path to ws: the Box's door lets it through even when the files group is at ask. */
  isPermitted(path: string): boolean {
    return (this.permits.get(path) ?? 0) > 0
  }

  /** ws inside the Box moves the file between the Box's disk and R2; its token and the Worker's address were written when the Box booted. The Workspace `key` is open to it for the length of the call. */
  private async ws(backend: BoxBackend, key: string, args: string, bytes: number): Promise<void> {
    const seconds = Math.ceil(copyTimeoutMs(bytes) / 1000)
    this.permits.set(key, (this.permits.get(key) ?? 0) + 1)
    const result = await backend.run(`ws ${args}`, BOX_ROOT, seconds).finally(() => {
      const left = (this.permits.get(key) ?? 1) - 1
      if (left > 0) this.permits.set(key, left)
      else this.permits.delete(key)
    })
    if (result.exitCode !== 0) throw new CopyRefused({ message: `copy: ws ${result.exitCode === 124 ? `ran out of time (${seconds} s)` : 'failed'}: ${(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, 500)}` })
  }

  private async workspaceToBox(fromPath: string, toPath: string): Promise<Moved> {
    const key = workspaceKey(fromPath)
    refuseOwned(toPath)
    const target = boxPath(toPath)
    const owned = await ownedBytes(this.deps.workspace, key)
    const object = owned === undefined ? await this.deps.workspace.run(this.deps.workspace.workspace.stat(key)) : undefined
    if (owned === undefined && object === undefined) throw new MissingFile({ place: 'your Workspace', path: key, message: `copy: no file "${key}" in your Workspace` })
    const backend = await this.deps.box.boot()
    try {
      // An owner's file or a doc is a few lines of text kept in the Worker, not an object ws could fetch.
      if (owned !== undefined) {
        await backend.write(target, owned)
        return { from: `/workspace/${key}`, to: target, bytes: owned.byteLength }
      }
      const size = object?.size ?? 0
      await this.ws(backend, key, `get ${shellQuote(key)} ${shellQuote(target)}`, size)
      return { from: `/workspace/${key}`, to: target, bytes: size }
    } finally {
      await this.deps.box.touch()
    }
  }

  private async boxToWorkspace(fromPath: string, toPath: string): Promise<Moved> {
    refuseOwned(fromPath)
    const source = boxPath(fromPath)
    const key = writableWorkspaceKey(toPath)
    const backend = await this.deps.box.boot()
    try {
      const sized = await backend.run(`stat -c %s ${shellQuote(source)}`, BOX_ROOT, 10).catch(() => ({ stdout: '', exitCode: 1 }))
      const bytes = Number(sized.stdout.trim())
      if (sized.exitCode !== 0 || !Number.isSafeInteger(bytes)) throw new MissingFile({ place: 'your Box', path: source, message: `copy: ${source} does not exist on your Box` })
      await this.ws(backend, key, `put ${shellQuote(source)} ${shellQuote(key)}`, bytes)
      return { from: source, to: `/workspace/${key}`, bytes }
    } finally {
      await this.deps.box.touch()
    }
  }

  /**
   * A Host file into the Workspace: the Host app puts it to R2 over presigned URLs, in parts; the Worker plans the parts, hands the Host
   * their links one window at a time (so that no link outlives its use) and completes the upload.
   */
  private async hostToWorkspace(link: HostLink, hostPath: string, workspacePath: string): Promise<Moved> {
    refuseOwnedOnHost(hostPath)
    const key = writableWorkspaceKey(workspacePath)
    const file = await link.copySize(hostPath)
    const { transfers } = this.deps
    const plan = await transfers.upload(key, file.size)
    try {
      const etags: Array<{ number: number; etag: string }> = []
      for (let at = 0; at < plan.parts.length; at += this.deps.windowParts) {
        const parts = await transfers.linkedParts(key, plan, plan.parts.slice(at, at + this.deps.windowParts))
        etags.push(...(await link.upload({ path: hostPath, size: file.size, parts })).etags)
      }
      await transfers.finish(key, plan.uploadId, etags)
    } catch (error) {
      if (plan.uploadId !== undefined) await transfers.abort(key, plan.uploadId).catch(() => undefined)
      throw error
    }
    return { from: file.path, to: `/workspace/${key}`, bytes: file.size }
  }

  /**
   * A Workspace file onto a Host: the Host app fetches it from R2 over a presigned URL, range by range, one window at a time with a fresh
   * link each. An owner's file or a doc is text kept in the Worker, and goes over the Host's write.
   */
  private async workspaceToHost(link: HostLink, workspacePath: string, hostPath: string): Promise<Moved> {
    refuseOwnedOnHost(hostPath)
    const key = workspaceKey(workspacePath)
    const owned = await ownedBytes(this.deps.workspace, key)
    if (owned !== undefined) {
      const written = await link.write(hostPath, new TextDecoder().decode(owned), 'text')
      return { from: `/workspace/${key}`, to: written.path, bytes: written.bytes }
    }
    const { transfers } = this.deps
    const first = await transfers.download(key, 'host')
    let received = { path: hostPath, bytes: 0 }
    for (let from = 0; ; ) {
      const plan = from === 0 ? first : await transfers.download(key, 'host')
      if (plan.size !== first.size) throw new CopyRefused({ message: `copy: "${key}" changed in your Workspace while it was copied` })
      const until = Math.min(first.size, from + first.partBytes * this.deps.windowParts)
      received = await link.download({ path: hostPath, url: plan.url, size: first.size, partBytes: first.partBytes, from, until })
      if (until >= first.size) break
      from = until
    }
    return { from: `/workspace/${key}`, to: received.path, bytes: first.size }
  }
}
