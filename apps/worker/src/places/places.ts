/**
 * The places of a Robot (v1.16 ticket 01, ob-5fjs, ob-ff4g, ob-9afl, ob-dyg4, ob-qnf7): one capability for run, the file tools, copy and the job
 * tools. A call names its place with `on`; this service checks the name against the Robot's grants before anything else, then dispatches to
 * the filesystem backend of the place (files.ts) or to the jobs of the place (jobs.ts). A later ticket that gives a place new powers (a Host
 * through DSH, files without limit) changes its backend, not the tools.
 *
 * Refusals are tagged errors (errors.ts) thrown from here; the tool boundary words them.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { GrantLevel, HostView, WorkspaceSetting } from '@mr-robot/protocol'
import type { UploadPart } from '@mr-robot/host-protocol'
import type { WorkspaceHost } from '../agent/host.ts'
import { waitingResult, type GrantItem, type ToolCallRequest, type WaitingResult } from '../agent/ask-gate.ts'
import type { BoxBackend } from '../box/backend.ts'
import { runWs, type CopyPermits } from './copy-permit.ts'
import { AmbiguousPlace, ApprovedHostsChanged, BadCall, casesHandled, CopyRefused, MissingFile, NoGrant, UnknownPlace, WrongPlace } from './errors.ts'
import { shellQuote } from './file-ops.ts'
import { BoxFiles, boxPath, BOX_ROOT, HostFiles, STAGING_DIRECTORY, ownedBytes, refuseOwnedOnHost, workspaceKey, WorkspaceFiles, writableWorkspaceKey, type BoxAccess, type HostFileLink, type PlaceFiles, type ReadHashes } from './files.ts'
import { hostFacetKey, hostIdOfPlace } from './host-facet.ts'
import { lookUpHost } from './host-names.ts'
import type { JobId } from './job-id.ts'
import type { Transfers } from './transfers.ts'
import { Jobs, type JobEntry, type JobPlace, type JobOutputView, type KillView, type RunResult } from './jobs.ts'
import { BOX_PLACE, FILES_PLACE, parseOn, placeName, refuseOwned, WORKSPACE_ALIAS_NOTICE, WORKSPACE_PLACE, type JobsPlace, type Place, type PlaceFacet, type Reach } from './place.ts'

/** One Host as the Robot reaches it: the Host RPCs, each failing as a Host call fails (offline, refused, an OS error). */
export interface HostLink extends HostFileLink {
  /** The Robot's next current directory in its Workspace there (v1.21, cw-llvx), checked by the app. */
  workingDirectory(cd: string): Promise<{ readonly path: string }>
  /** The Robot's worktree in its Workspace there (v1.21, cw-11je), made by the app. */
  createWorktree(): Promise<{ readonly path: string; readonly branch: string; readonly baseCommit: string; readonly repositoryRoot: string }>
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
  /** The levels the Robot holds the places at now, read at each call: the files group, the box group (deny when the Space has the plugin off), a Host's facet. */
  workspaceLevel(): GrantLevel
  boxLevel(): GrantLevel
  hostLevel(hostId: string, facet: PlaceFacet): GrantLevel
  /** The Hosts the Robot's owner reaches. */
  hosts(): Promise<readonly HostView[]>
  /** The Robot's Workspace (v1.21, cw-gx04); undefined when it has none. */
  workspaceSetting(): WorkspaceSetting | undefined
  /**
   * The current directory in the Workspace of the agent that makes a call (cw-llvx, cw-4nkx): the Robot's own, kept by the platform, or a
   * Subagent's, kept in memory and first the Robot's.
   */
  currentDirectory(exec: ToolRunContext): string
  setCurrentDirectory(exec: ToolRunContext, path: string): void
  /** A read, write or edit of the agent reached into its Workspace: its instructions may have grown (cw-hm3d). */
  touched(exec: ToolRunContext): void
  /** Whether the call is the Robot's own, not a Subagent's: only the Robot creates a worktree (cw-4nkx). */
  isRobot(exec: ToolRunContext): boolean
  /** Keep the Robot's new worktree in its Workspace and move it there (cw-11je). */
  worktreeCreated(path: string): void
  readonly box: BoxAccess
  /** One Host; `cwd` when the calls name the Robot's Workspace there. */
  link(host: HostView, reach: Reach, cwd?: string): HostLink
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

/** How many read hashes an agent keeps (cw-jko0). */
const READ_HASHES_KEPT = 500

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
   * @throws NoGrant, UnknownPlace, AmbiguousPlace or WrongPlace.
   */
  private async resolve(on: string, facet: PlaceFacet, tool: string, exec: ToolRunContext): Promise<Granted> {
    const name = parseOn(on, tool)
    if (name === FILES_PLACE || (name === WORKSPACE_PLACE && this.aliased())) {
      if (facet === 'shell') throw new WrongPlace({ on: name, message: name === FILES_PLACE ? `on "files": your Files hold files, they run no commands. Run on "box" or on one of your owner's computers.` : `on "workspace": you have no Workspace, and your Files (on "files") run no commands. Run on "box" or on one of your owner's computers.` })
      const level = this.deps.inSetup() ? 'allow' : this.deps.workspaceLevel()
      return granted({ kind: 'files' }, { kind: 'tool', name: 'files' }, level, () => noGrant(name, 'your Files', 'the tool group "files"'))
    }
    if (this.deps.inSetup()) throw new NoGrant({ on: name, what: 'any place but your Files', grant: 'none while in setup', message: `on "${name}": while you are being set up you reach only your Files (on "files").` })
    if (name === WORKSPACE_PLACE) return this.workspacePlace(facet, exec)
    if (name === BOX_PLACE) return granted({ kind: 'box' }, { kind: 'tool', name: 'box' }, this.deps.boxLevel(), () => noGrant(name, 'your Box', 'the tool group "box"'))
    const host = await this.hostNamed(name)
    return granted({ kind: 'host', host }, { kind: 'host', name: hostFacetKey(host.id, facet) }, this.deps.hostLevel(host.id, facet), () => noGrant(name, `the ${facet} of ${host.name}`, `the grant "${host.name} · ${facet}"`))
  }

  /** Whether "workspace" is the old name of "files" for this Robot: it has no Workspace, or it is in setup (cw-shlm). */
  private aliased(): boolean {
    return this.deps.inSetup() || this.deps.workspaceSetting() === undefined
  }

  /** The notice a call's result carries when it named "workspace" and went to the Files (cw-shlm); undefined otherwise. */
  aliasNotice(...ons: readonly unknown[]): string | undefined {
    return ons.some((on) => typeof on === 'string' && on.trim() === WORKSPACE_PLACE) && this.aliased() ? WORKSPACE_ALIAS_NOTICE : undefined
  }

  /**
   * The Robot's Workspace as a place (cw-6xs7): its Host, under the Host's facet grant, with the current directory of the agent that calls.
   * @throws NoGrant when the Host is not among those the owner reaches now, or the Robot holds no grant on the facet there.
   */
  private async workspacePlace(facet: PlaceFacet, exec: ToolRunContext): Promise<Granted> {
    const setting = this.deps.workspaceSetting()
    if (setting === undefined) throw new WrongPlace({ on: WORKSPACE_PLACE, message: 'on "workspace": you have no Workspace.' })
    const found = lookUpHost(await this.deps.hosts(), setting.hostId)
    if (found.kind !== 'found') throw new NoGrant({ on: WORKSPACE_PLACE, what: `your Workspace's computer ${setting.host}`, grant: `the grant "${setting.host} · ${facet}"`, message: `on "workspace": your Workspace is on ${setting.host}, which is not among the computers your owner reaches now (unpaired, or no longer shared).` })
    const host = found.host
    return granted({ kind: 'host', host, workspace: { cwd: this.deps.currentDirectory(exec) } }, { kind: 'host', name: hostFacetKey(host.id, facet) }, this.deps.hostLevel(host.id, facet), () => noGrant(WORKSPACE_PLACE, `the ${facet} of ${host.name}, where your Workspace is`, `the grant "${host.name} · ${facet}"`))
  }

  /**
   * The Robot's current directory in its Workspace, or a move to another one within the repository (cw-llvx): the app checks the directory,
   * and the platform keeps it for the agent that called (the Robot across Turns, a Subagent for its run). It needs the Workspace's files
   * facet and changes nothing on the computer, so it never waits for the owner.
   */
  async workingDirectory(cd: string | undefined, exec: ToolRunContext): Promise<{ readonly cwd: string; readonly root: string; readonly repository: string; readonly host: string }> {
    const target = await this.workspacePlace('files', exec)
    const setting = this.deps.workspaceSetting()!
    const place = target.place
    if (place.kind !== 'host' || place.workspace === undefined) throw new WrongPlace({ on: WORKSPACE_PLACE, message: 'working_directory: you have no Workspace.' })
    const answer = { root: setting.root, repository: setting.repository, host: place.host.name }
    if (cd === undefined || cd.trim() === '') return { cwd: place.workspace.cwd, ...answer }
    const moved = await this.deps.link(place.host, 'granted', place.workspace.cwd).workingDirectory(cd.trim())
    this.deps.setCurrentDirectory(exec, moved.path)
    return { cwd: moved.path, ...answer }
  }

  /**
   * Create the Robot's worktree (cw-11je, cw-zuyu): the app makes it with DSH's runtime from the checkout of the current directory; the
   * platform keeps it in the Workspace setting, whose write roots then become the worktree and the repository's .git, and moves the
   * Robot there. It writes on the computer, so it waits for the owner when the Workspace's files facet is at ask. A Subagent cannot.
   */
  async createWorktree(call: PlaceCall): Promise<{ readonly path: string; readonly branch: string; readonly baseCommit: string; readonly repositoryRoot: string } | WaitingResult> {
    if (!this.deps.isRobot(call.exec)) throw new WrongPlace({ on: WORKSPACE_PLACE, message: 'create_worktree: a Subagent works in its Robot\'s Workspace and does not create a worktree; say in your report that one is needed.' })
    const target = await this.workspacePlace('files', call.exec)
    const place = target.place
    if (place.kind !== 'host' || place.workspace === undefined) throw new WrongPlace({ on: WORKSPACE_PLACE, message: 'create_worktree: you have no Workspace.' })
    if (this.deps.workspaceSetting()?.worktree !== undefined) throw new WrongPlace({ on: WORKSPACE_PLACE, message: `create_worktree: you have a worktree already, ${this.deps.workspaceSetting()!.worktree}.` })
    const waiting = this.waiting(call, [target])
    if (waiting !== undefined) return waiting
    const created = await this.deps.link(place.host, 'granted', place.workspace.cwd).createWorktree()
    this.deps.worktreeCreated(created.path)
    return created
  }

  /**
   * A Host the Robot names, by id or by the name it calls the Host (host-names.ts: two Hosts of one name go by their owners' names), among
   * those its owner reaches; it comes back under that name.
   * @throws UnknownPlace when there is none, AmbiguousPlace when the name is the own name of more than one; a failed lookup is the Space's own error.
   */
  async hostNamed(name: string): Promise<HostView> {
    const found = lookUpHost(await this.deps.hosts(), name)
    switch (found.kind) {
      case 'found':
        return found.host
      case 'shared':
        throw new AmbiguousPlace({ on: name, names: found.names, message: `on "${name}": more than one of your owner's computers has this name. Name the one you mean: ${found.names.map((known) => `"${known}"`).join(', ')}.` })
      case 'unknown':
        throw new UnknownPlace({ on: name, known: found.names, message: `on "${name}": there is no such place. Use workspace, box or one of your owner's computers: ${found.names.length === 0 ? 'none are paired' : found.names.join(', ')}.` })
      default:
        return casesHandled(found)
    }
  }

  /** The place a call to run or a job tool names. */
  private async shellPlace(on: string, tool: string, exec: ToolRunContext): Promise<Granted<JobsPlace>> {
    const reached = await this.resolve(on, 'shell', tool, exec)
    const place = reached.place
    if (place.kind === 'files') throw new WrongPlace({ on, message: `${tool}: your Files run no commands` })
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

  private filesOf(place: Place, reach: Reach, exec: ToolRunContext): PlaceFiles {
    if (place.kind === 'files') return this.workspaceFiles
    if (place.kind === 'box') return new BoxFiles(this.deps.box)
    return new HostFiles(this.deps.link(place.host, reach, place.workspace?.cwd), { hostId: place.host.id, cwd: place.workspace?.cwd, hashes: this.hashesOf(exec) })
  }

  /** The hashes of the files an agent read on computers (cw-jko0), by the agent's session: the Robot's, or each Subagent's. */
  private readonly readHashes = new Map<string, Map<string, string>>()
  private hashesOf(exec: ToolRunContext): ReadHashes {
    const agent = String(exec.agent?.session.id ?? 'robot')
    const known = this.readHashes.get(agent) ?? new Map<string, string>()
    this.readHashes.set(agent, known)
    return {
      get: (key) => known.get(key),
      set: (key, hash) => {
        known.delete(key)
        known.set(key, hash)
        // The newest READ_HASHES_KEPT stay; a file read long ago is written as before, without a check.
        for (const oldest of known.keys()) {
          if (known.size <= READ_HASHES_KEPT) break
          known.delete(oldest)
        }
      },
      delete: (key) => { known.delete(key) },
    }
  }

  /**
   * Do `action` on the files of the place `on` names. A call to a place at ask, or one that asked to escalate (it then acts on a computer
   * without the sandbox, once), waits for the owner: the answer is the waiting result, and the approved call comes back here and runs.
   */
  async withFiles<A>(on: string, call: PlaceCall, action: (files: PlaceFiles) => Promise<A>): Promise<A | WaitingResult> {
    const target = await this.resolve(on, 'files', call.tool, call.exec)
    const unconfined = this.unconfined(call, target, `${call.tool}: escalate lifts the sandbox of a computer. ${target.place.kind === 'box' ? 'Your Box has none to lift: it is yours.' : 'Your Files have none to lift.'}`)
    const waiting = this.waiting(call, [target], unconfined)
    if (waiting !== undefined) return waiting
    if (target.place.kind === 'host' && target.place.workspace !== undefined && ['read', 'write', 'edit'].includes(call.tool)) this.deps.touched(call.exec)
    return action(this.filesOf(target.place, unconfined === undefined ? 'granted' : 'escalated', call.exec))
  }

  // ---------------------------------------------------------------- run and jobs

  async run(input: RunInput, call: PlaceCall): Promise<RunResult | WaitingResult> {
    const target = await this.shellPlace(input.on, 'run', call.exec)
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
    return this.waiting(call, [await this.shellPlace(hostIdOfPlace(stored) ?? BOX_PLACE, call.tool, call.exec)])
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
    const sourceEnd = await this.resolve(from.on, 'files', 'copy', call.exec)
    const targetEnd = await this.resolve(to.on, 'files', 'copy', call.exec)
    const unconfined = this.unconfined(call, targetEnd, 'copy: escalate lifts the sandbox of the computer a file is written to, and the destination is not a computer.')
    const waiting = this.waiting(call, [sourceEnd, targetEnd], unconfined)
    if (waiting !== undefined) return waiting
    const reach: Reach = unconfined === undefined ? 'granted' : 'escalated'
    const source = sourceEnd.place
    const target = targetEnd.place
    const links = [source, target].flatMap((place) => place.kind === 'host' ? [this.deps.link(place.host, 'granted', place.workspace?.cwd)] : [])
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
    if (source.kind === 'files' && target.kind === 'files') return this.workspaceToWorkspace(fromPath, toPath)
    if (source.kind === 'host' && target.kind === 'files') return this.hostToWorkspace(this.deps.link(source.host, 'granted', source.workspace?.cwd), fromPath, toPath)
    if (source.kind === 'files' && target.kind === 'host') return this.workspaceToHost(this.deps.link(target.host, reach, target.workspace?.cwd), fromPath, toPath)
    if (source.kind === 'files' && target.kind === 'box') return this.workspaceToBox(fromPath, toPath)
    if (source.kind === 'box' && target.kind === 'files') return this.boxToWorkspace(fromPath, toPath)
    return this.staged(source, target, fromPath, toPath, reach)
  }

  /** Two Hosts, or the Box and a Host: the file goes to the Workspace first and from there on; the staged copy is deleted whatever happens. */
  private async staged(source: Place, target: Place, fromPath: string, toPath: string, reach: Reach): Promise<Moved> {
    const directory = stagingDirectory()
    const parked = `${directory}/file`
    try {
      const first = await this.transfer(source, { kind: 'files' }, fromPath, parked, 'granted')
      const second = await this.transfer({ kind: 'files' }, target, parked, toPath, reach)
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
      const written = await link.write(hostPath, new TextDecoder().decode(owned), 'text', { id: crypto.randomUUID() })
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
