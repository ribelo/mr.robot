/**
 * The Robot's side of a Host call (v1.16 tickets 01, 03 and 06): one Host as the places reach it (the file RPCs and copy) and as the jobs reach it
 * (the command and job RPCs). Every call goes through the Member DO that owns the Host, under the Robot's grant for the facet; `reach`
 * says whether the owner approved this call to run without the sandbox.
 */
import type { HostView } from '@mr-robot/protocol'
import { answerOf, type HostCallReply } from '../member/host-call.ts'
import type { Member } from '../member/member.ts'
import { HostRunner, type HostJobLink, type HostRuns } from './host-runner.ts'
import { hostPlace, type Reach } from './host-facet.ts'
import type { JobPlace } from './jobs.ts'
import type { HostLink } from './places.ts'

/** What a Host call needs of the Robot around it. */
export interface HostCaller {
  readonly robotId: string
  /** The Member DO of the owner of a Host. */
  owner(hostId: string): Promise<DurableObjectStub<Member>>
  /**
   * A Host call, failing as Host calls fail (hs-bfr8): offline, refused, an OS error; a mode that does not allow it and a computer with no
   * sandbox as the place errors WriteDenied and SandboxUnavailable.
   */
  call<A>(host: string, call: () => Promise<HostCallReply<A>>): Promise<A>
  readonly runs: HostRuns
  /** Keeps the Robot up while the Run call is pending. */
  keepAlive(pending: Promise<unknown>): void
  rearm(): Promise<void>
}

/** One Host as the Robot's places reach it; `cwd` when the calls name the Robot's Workspace there (v1.21, cw-6xs7). */
export function hostLink(caller: HostCaller, host: HostView, reach: Reach, cwd?: string): HostLink {
  const { robotId } = caller
  const owner = () => caller.owner(host.id)
  const call = <A>(action: () => Promise<HostCallReply<A>>): Promise<A> => caller.call(host.name, action)
  return {
    name: host.name,
    read: (path) => call(async () => (await owner()).hostRead(host.id, robotId, path, cwd)),
    write: (path, content, encoding) => call(async () => (await owner()).hostWrite(host.id, robotId, encoding === 'base64' ? { path, base64: content } : { path, text: content }, reach, cwd)),
    glob: (pattern) => call(async () => (await owner()).hostGlob(host.id, robotId, pattern, cwd)),
    grep: (input) => call(async () => (await owner()).hostGrep(host.id, robotId, input, cwd)),
    remove: (path) => call(async () => (await owner()).hostDelete(host.id, robotId, path, reach, cwd)),
    copySize: (path) => call(async () => (await owner()).hostCopySize(host.id, robotId, path, cwd)),
    upload: (input) => call(async () => (await owner()).hostUpload(host.id, robotId, input, cwd)),
    download: (input) => call(async () => (await owner()).hostDownload(host.id, robotId, input, reach, cwd)),
    workingDirectory: (cd) => call(async () => (await owner()).hostWorkingDirectory(host.id, robotId, cd, cwd ?? '')),
    recordCopy: async (detail, outcome) => (await owner()).recordHostCopy(host.id, robotId, detail, outcome),
  }
}

/**
 * A Host as a place for jobs (v1.16 ticket 03): its app runs the commands as jobs of DSH's jobs-local and keeps them while it runs. The
 * place is always "up"; a Host that is gone or has restarted is told by its Member (hostJobsLost), a job the Host no longer knows is gone when
 * the alarm asks, and so is a job on a Host this Robot can no longer reach (shared no more, or the grant lowered).
 */
export function hostJobPlace(caller: HostCaller, host: { readonly id: string; readonly name: string }, reach: Reach, cwd?: string): JobPlace {
  const { robotId } = caller
  const owner = () => caller.owner(host.id)
  const call = <A>(action: () => Promise<HostCallReply<A>>): Promise<A> => caller.call(host.name, action)
  const link: HostJobLink = {
    start: ({ job, command, cwd: given, timeoutMs, background }) => call(async () => (await owner()).hostRun(host.id, robotId, { command, ...(given === undefined ? {} : { cwd: given }), timeoutMs, background, job }, reach, cwd)),
    // The alarm asks for the state of every running job: the Host's own failure comes back (HostAccessLost, HostOffline), so that a Host
    // that is away is told from one the Robot lost access to.
    list: async () => answerOf(await (await owner()).hostJobList(host.id, robotId)),
    output: (job, stream, offset) => call(async () => (await owner()).hostJobOutput(host.id, robotId, job, stream, offset)),
    kill: async (job) => { await call(async () => (await owner()).hostJobKill(host.id, robotId, job)) },
  }
  const runner = new HostRunner(caller.runs, host.name, link, (pending) => caller.keepAlive(pending))
  return {
    place: hostPlace(host.id),
    name: host.name,
    label: host.name,
    on: host.name,
    subject: host.name,
    lost: `${host.name} lost it while it ran, or your access to it ended`,
    start: async () => runner,
    runner: () => runner,
    alive: async () => true,
    touch: () => caller.rearm(),
  }
}
