/**
 * The places of a Robot (v1.16 ticket 01, ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7): one capability for run, the file tools, copy and the job
 * tools. A call names its place with `on`; this service checks the name against the Robot's grants before anything else, then dispatches to
 * the filesystem backend of the place (files.ts) or to the jobs of the place (jobs.ts). A later ticket that gives a place new powers (a Host
 * through DSH, files without limit) changes its backend, not the tools.
 *
 * Refusals are tagged errors (errors.ts) thrown from here; the tool boundary words them.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { GrantLevel, HostView } from '@mr-robot/protocol'
import type { UploadPart } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import { waitingResult, type GrantItem, type ToolCallRequest, type WaitingResult } from '../agent/ask-gate.ts'
import type { BoxBackend } from '../box/backend.ts'
import { runWs, type CopyPermits } from './copy-permit.ts'
import { ApprovedHostsChanged, BadCall, CopyRefused, MissingFile, NoGrant, UnknownPlace, WrongPlace } from './errors.ts'
import { shellQuote } from './file-ops.ts'
import { BoxFiles, boxPath, BOX_ROOT, HostFiles, STAGING_DIRECTORY, ownedBytes, refuseOwnedOnHost, workspaceKey, WorkspaceFiles, writableWorkspaceKey, type BoxAccess, type HostFileLink, type PlaceFiles } from './files.ts'
import { hostFacetKey, hostIdOfPlace } from './host-facet.ts'
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
  /**
   * The Host app fetches the bytes from `from` to `until` of an object into the part file of the copy `copy`, range by range; the file
   * appears when `until` is the size.
   */
  download(input: { copy: string; path: string; url: string; size: number; partBytes: number; from: number; until: number }): Promise<{ readonly path: string; readonly bytes: number }>
  /** The copy as a whole is one line in the Host's log. */
  recordCopy(detail: string, outcome: string): Promise<void>
}

export interface PlacesDeps {
  readonly workspace: WorkspaceHost
  /** Whether the Robot is in setup: its first Conversation writes its persona files, so it reaches its Workspace and no other place. */
  inSetup(): boolean
  /** The levels the Robot holds the places at now, read at each call: the files group, the box group (deny when the Home has the plugin off), a Host's facet. */
  workspaceLevel(): GrantLevel
  boxLevel(): GrantLevel
  hostLevel(hostId: string, facet: PlaceFacet): GrantLevel
  /** The Hosts the Robot's owner reaches. */
  hosts(): Promise<readonly HostView[]>
  readonly box: BoxAccess
  link(host: HostView, reach: Reach): HostLink
  /** The jobs of a place; `reach` makes a Host command run without the sandbox when the owner approved that. */
  jobPlace(place: JobsPlace, reach: Reach): JobPlace
  /**
   * The tool-call Asks (sk-hx8j, ob-ifak): the one-call Ask of a call to a place at ask, or with escalate. The owner's approval runs the same
   * call again, and only then is it approved.
   */
  readonly asks: {
    /** The Hosts an approved call was asked for, by id in the order it names them; undefined when the call is not one the owner approved. */
    approval(callId: string): { readonly hosts: readonly string[] } | undefined
    ask(request: ToolCallRequest, exec: ToolRunContext): { readonly askId: string }
  }
  readonly jobs: Jobs
  /** The Robot's Workspace as presigned URLs: how a file reaches a Host without the Worker in the pipe. */
  readonly transfers: Transfers
  /** The permits of the runs of ws the Robot starts on its Box; the Box's door finds them by secret. */
  readonly permits: CopyPermits
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
 * One call of a tool as the Robot made it. When the call has to wait for the owner (its place is at ask, or it asks to run once without the
 * sandbox, ob-ifak), the Ask stores the arguments exactly as given, and the platform runs them again when the owner approves.
 */
export interface PlaceCall {
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  /** The call asks to run once without the sandbox of the computer it acts on. */
  readonly escalate: boolean
  readonly exec: ToolRunContext
}

export interface RunInput {
  readonly on: string
  readonly command: string
  readonly cwd?: string
  readonly seconds: number
  readonly background: boolean
}

/** A place a call may use: the grant item it stands under, and its level (at ask each call waits for the owner). */
interface Granted<P extends Place = Place> {
  readonly place: P
  readonly item: GrantItem
  readonly level: 'allow' | 'ask'
}

/** What the owner reads when a call that waits for them came without a reason: the tool was registered when nothing it reaches was at ask, so it asked for none. */
const NO_REASON = 'No reason given.'

/** What a copy moved: both paths as the places print them, and the bytes. */
interface Moved {
  readonly from: string
  readonly to: string
  readonly bytes: number
}

/**
 * Where a copy that has two Hosts or a Host and the Box as its ends parks the file: tmp/<id>/ in the Workspace, deleted when the copy
 * ends (and by the Robot's daily tidy pass when a restart cut the copy off, workspace/spill.ts).
 */
const stagingDirectory = (): string => `${STAGING_DIRECTORY}/${crypto.randomUUID()}`

const noGrant = (on: string, what: string, grant: string): NoGrant =>
  new NoGrant({ on, what, grant, message: `on "${on}": you hold no grant on ${what} (${grant}). Your owner can give it: propose it with propose_grants.` })

/** The place a call may use at the level it holds, or the refusal that names the grant. */
function granted<P extends Place>(place: P, item: GrantItem, level: GrantLevel, refusal: () => NoGrant): Granted<P> {
  if (level === 'deny') throw refusal()
  return { place, item, level }
}

const sameItem = (a: GrantItem, b: GrantItem): boolean => a.kind === b.kind && a.name === b.name

export class Places {
  private readonly workspaceFiles: WorkspaceFiles

  constructor(private readonly deps: PlacesDeps) {
    this.workspaceFiles = new WorkspaceFiles(deps.workspace)
  }

  /**
   * The place a call names, with the level the Robot holds it at (allow or ask: a call to a place at ask waits for the owner, see waiting).
   * While in setup the Robot reaches its Workspace and nothing else.
   * @throws NoGrant, UnknownPlace or WrongPlace.
   */
  private async resolve(on: string, facet: PlaceFacet, tool: string): Promise<Granted> {
    const name = parseOn(on, tool)
    if (name === WORKSPACE_PLACE) {
      if (facet === 'shell') throw new WrongPlace({ on: name, message: `on "workspace": the Workspace holds files, it runs no commands. Run on "box" or on one of your owner's computers.` })
      const level = this.deps.inSetup() ? 'allow' : this.deps.workspaceLevel()
      return granted({ kind: 'workspace' }, { kind: 'tool', name: 'files' }, level, () => noGrant(name, 'your Workspace files', 'the tool group "files"'))
    }
    if (this.deps.inSetup()) throw new NoGrant({ on: name, what: 'any place but your Workspace', grant: 'none while in setup', message: `on "${name}": while you are being set up you reach only your Workspace (on "workspace").` })
    if (name === BOX_PLACE) return granted({ kind: 'box' }, { kind: 'tool', name: 'box' }, this.deps.boxLevel(), () => noGrant(name, 'your Box', 'the tool group "box"'))
    const host = await this.hostNamed(name)
    return granted({ kind: 'host', host }, { kind: 'host', name: hostFacetKey(host.id, facet) }, this.deps.hostLevel(host.id, facet), () => noGrant(name, `the ${facet} of ${host.name}`, `the grant "${host.name} · ${facet}"`))
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
  private async shellPlace(on: string, tool: string): Promise<Granted<JobsPlace>> {
    const reached = await this.resolve(on, 'shell', tool)
    const place = reached.place
    if (place.kind === 'workspace') throw new WrongPlace({ on, message: `${tool}: the Workspace runs no commands` })
    return { ...reached, place }
  }

  /**
   * Whether a call waits for the owner instead of running now (sk-hx8j, ob-ifak): a place it uses is at ask, or it asks to run without the
   * sandbox of the computer `unconfined`. One tool-call Ask covers both, the same Ask the ask gate stores; the call the owner approved
   * comes back here and runs. A level is read at each call, so a place that went to ask after the tools were registered still asks.
   * The Ask keeps the Hosts the call's places resolved to, by id; the approved call runs only when its places resolve to the same Hosts
   * again, so a computer renamed, unpaired or paired under the same name meanwhile does not get a call the owner approved for another
   * (deep review P14).
   * @returns the waiting result the Robot is told, or undefined when the call runs now.
   * @throws ApprovedHostsChanged when the approved call names other Hosts now.
   */
  private waiting(call: PlaceCall, used: readonly Granted[], unconfined?: Granted): WaitingResult | undefined {
    const approval = this.deps.asks.approval(String(call.exec.callId))
    if (approval !== undefined) {
      const now = used.flatMap((reached) => (reached.place.kind === 'host' ? [reached.place.host] : []))
      const same = now.length === approval.hosts.length && now.every((host, at) => host.id === approval.hosts[at])
      if (!same) {
        throw new ApprovedHostsChanged({
          tool: call.tool,
          message: `${call.tool} did not run: the computers it names (${now.map((host) => host.name).join(', ') || 'none'}) are not the ones your owner approved it for. A computer was renamed, unpaired or paired under the same name meanwhile. Check which computer you mean, and call it again if you still need it.`,
        })
      }
      return undefined
    }
    const items: GrantItem[] = []
    for (const item of [...used.filter((reached) => reached.level === 'ask').map((reached) => reached.item), ...(unconfined === undefined ? [] : [unconfined.item])]) {
      if (!items.some((known) => sameItem(known, item))) items.push(item)
    }
    if (items.length === 0) return undefined
    const given = call.arguments['reason']
    const reason = typeof given === 'string' ? given.trim() : ''
    if (unconfined !== undefined && reason === '') throw new BadCall({ tool: call.tool, message: `${call.tool}: escalate needs a reason: your owner reads it before they approve the call.` })
    const { askId } = this.deps.asks.ask({ tool: call.tool, arguments: call.arguments, reason: reason === '' ? NO_REASON : reason, items, uses: used.map((reached) => reached.item) }, call.exec)
    return waitingResult(askId, call.tool)
  }

  /** The computer a call with escalate runs on without its sandbox, once approved. @throws BadCall when the place is not a computer. */
  private unconfined(call: PlaceCall, target: Granted, refusal: string): Granted | undefined {
    if (!call.escalate) return undefined
    if (target.place.kind !== 'host') throw new BadCall({ tool: call.tool, message: refusal })
    return target
  }

  private filesOf(place: Place, reach: Reach): PlaceFiles {
    return place.kind === 'workspace' ? this.workspaceFiles : place.kind === 'box' ? new BoxFiles(this.deps.box) : new HostFiles(this.deps.link(place.host, reach))
  }

  /**
   * Do `action` on the files of the place `on` names. A call to a place at ask, or one that asked to escalate (it then acts on a computer
   * without the sandbox, once), waits for the owner: the answer is the waiting result, and the approved call comes back here and runs.
   */
  async withFiles<A>(on: string, call: PlaceCall, action: (files: PlaceFiles) => Promise<A>): Promise<A | WaitingResult> {
    const target = await this.resolve(on, 'files', call.tool)
    const unconfined = this.unconfined(call, target, `${call.tool}: escalate lifts the sandbox of a computer. ${target.place.kind === 'box' ? 'Your Box has none to lift: it is yours.' : 'The Workspace has none to lift.'}`)
    const waiting = this.waiting(call, [target], unconfined)
    if (waiting !== undefined) return waiting
    return action(this.filesOf(target.place, unconfined === undefined ? 'granted' : 'escalated'))
  }

  // ---------------------------------------------------------------- run and jobs

  async run(input: RunInput, call: PlaceCall): Promise<RunResult | WaitingResult> {
    const target = await this.shellPlace(input.on, 'run')
    const place = target.place
    const cwd = input.cwd === undefined ? undefined : place.kind === 'box' ? boxPath(input.cwd) : input.cwd
    const unconfined = this.unconfined(call, target, 'run: escalate lifts the sandbox of a computer. Your Box has none to lift: it is yours.')
    const waiting = this.waiting(call, [target], unconfined)
    if (waiting !== undefined) return waiting
    return this.deps.jobs.run(this.deps.jobPlace(place, unconfined === undefined ? 'granted' : 'escalated'), { command: input.command, cwd, seconds: input.seconds, background: input.background }, call.exec.signal)
  }

  /** The place a job runs in must still be one the Robot may use; at ask the call waits for the owner, by that place. */
  private async jobWaiting(id: JobId, call: PlaceCall): Promise<WaitingResult | undefined> {
    const stored = this.deps.jobs.placeOfJob(id)
    if (stored === undefined) return undefined
    return this.waiting(call, [await this.shellPlace(hostIdOfPlace(stored) ?? BOX_PLACE, call.tool)])
  }

  jobList(): JobEntry[] {
    return this.deps.jobs.list()
  }

  async jobOutput(id: JobId, wait: boolean, timeoutMs: number, call: PlaceCall): Promise<JobOutputView | WaitingResult> {
    return (await this.jobWaiting(id, call)) ?? this.deps.jobs.output(id, wait, timeoutMs)
  }

  async jobKill(id: JobId, call: PlaceCall): Promise<KillView | WaitingResult> {
    return (await this.jobWaiting(id, call)) ?? this.deps.jobs.kill(id)
  }

  // ---------------------------------------------------------------- copy

  /**
   * Copy one file between two places, as it is (binary too), the content never passing through the model or the Worker. A Host and the
   * Workspace exchange it through presigned R2 URLs; the Box and the Workspace through ws inside the Box; inside the Workspace R2 copies it;
   * two Hosts, or the Box and a Host, stage it in the Workspace under tmp/ and delete it after (ob-d3rt, ob-qshq, ob-fgyk, ob-qr7v).
   * A copy that asked to escalate writes on its destination computer without the sandbox, once, after the owner approved; a copy with an
   * end at ask waits for the owner too.
   * @returns the waiting result when the owner is being asked.
   */
  async copy(from: CopyEnd, to: CopyEnd, call: PlaceCall): Promise<CopyResult | WaitingResult> {
    const started = Date.now()
    const sourceEnd = await this.resolve(from.on, 'files', 'copy')
    const targetEnd = await this.resolve(to.on, 'files', 'copy')
    const unconfined = this.unconfined(call, targetEnd, 'copy: escalate lifts the sandbox of the computer a file is written to, and the destination is not a computer.')
    const waiting = this.waiting(call, [sourceEnd, targetEnd], unconfined)
    if (waiting !== undefined) return waiting
    const reach: Reach = unconfined === undefined ? 'granted' : 'escalated'
    const source = sourceEnd.place
    const target = targetEnd.place
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

  /**
   * ws inside the Box moves the file between the Box's disk and R2; its token and the Worker's address were written when the Box booted.
   * This run of ws gets a permit for `key` in direction `op`, in its environment; the permit ends with the run.
   */
  private async ws(backend: BoxBackend, op: 'get' | 'put', key: string, args: string, bytes: number): Promise<void> {
    const result = await runWs(backend, this.deps.permits, op, key, args, bytes)
    if (result.exitCode !== 0) throw new CopyRefused({ message: `copy: ws ${result.exitCode === 124 ? `ran out of time (${result.seconds} s)` : 'failed'}: ${(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, 500)}` })
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
      await this.ws(backend, 'get', key, `${shellQuote(key)} ${shellQuote(target)}`, size)
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
      await this.ws(backend, 'put', key, `${shellQuote(source)} ${shellQuote(key)}`, bytes)
      return { from: source, to: `/workspace/${key}`, bytes }
    } finally {
      await this.deps.box.touch()
    }
  }

  /**
   * A Host file into the Workspace: the Host app puts it to R2 over presigned URLs, in parts; the Worker plans the parts, hands the Host
   * one part per call, with its link minted just before (so that no link outlives its use), and completes the upload. Each call has the
   * deadline of one part (hostPartDeadlineMs): a large file on a slow line finishes part by part.
   */
  private async hostToWorkspace(link: HostLink, hostPath: string, workspacePath: string): Promise<Moved> {
    refuseOwnedOnHost(hostPath)
    const key = writableWorkspaceKey(workspacePath)
    const file = await link.copySize(hostPath)
    const { transfers } = this.deps
    const plan = await transfers.upload(key, file.size)
    try {
      const etags: Array<{ number: number; etag: string }> = []
      for (const part of plan.parts) {
        const linked = await transfers.linkedPart(key, plan, part)
        etags.push(...(await link.upload({ path: hostPath, size: file.size, parts: [linked] })).etags)
      }
      await transfers.finish(key, plan.uploadId, etags)
    } catch (error) {
      if (plan.uploadId !== undefined) await transfers.abort(key, plan.uploadId).catch(() => undefined)
      throw error
    }
    return { from: file.path, to: `/workspace/${key}`, bytes: file.size }
  }

  /**
   * A Workspace file onto a Host: the Host app fetches it from R2 over a presigned URL, one part per call with a fresh link each, into a
   * part file of this copy's own (named by `copy`), and moves it into place after the last part. Each call has the deadline of one part.
   * An owner's file or a doc is text kept in the Worker, and goes over the Host's write.
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
    const copy = crypto.randomUUID()
    let received = { path: hostPath, bytes: 0 }
    for (let from = 0; ; ) {
      const plan = from === 0 ? first : await transfers.download(key, 'host')
      if (plan.size !== first.size) throw new CopyRefused({ message: `copy: "${key}" changed in your Workspace while it was copied` })
      const until = Math.min(first.size, from + first.partBytes)
      received = await link.download({ copy, path: hostPath, url: plan.url, size: first.size, partBytes: first.partBytes, from, until })
      if (until >= first.size) break
      from = until
    }
    return { from: `/workspace/${key}`, to: received.path, bytes: first.size }
  }
}
