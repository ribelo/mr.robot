/** Client and server of the Host protocol joined in this process, over the real handlers of the Host app. */
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Scope from 'effect/Scope'
import { makeHostClient, parseFrame, serveHost, type CopyIo, type HostAccess, type JobEnded } from '@mr-robot/host-protocol'
import { HostDownloads } from '../src/copy.ts'
import { hostHandlers } from '../src/handlers.ts'
import { HostShell } from '../src/shell.ts'

type Rpc = Record<string, (payload: unknown) => Effect.Effect<any, any>>

export async function connected(home: string, copyIo?: CopyIo, options: { readonly sandboxChain?: Parameters<typeof HostShell.start>[0]['sandboxChain']; readonly downloadIdleMs?: number } = {}) {
  const { downloadIdleMs, ...shellOptions } = options
  const shell = await HostShell.start({ home, ...shellOptions })
  // The downloads in flight outlive a connection, as in the app's link.
  const downloads = new HostDownloads(shell, downloadIdleMs)
  // What an earlier run left mid-copy goes when the app starts, as in the app's link.
  await downloads.removeLeftovers()
  // The job frames the app would send to the Worker.
  const ended: JobEnded[] = []
  shell.onJobEnded((job) => ended.push(job))
  const chrome = { devtools: async () => { throw new Error('no Chrome here') } } as never
  /** One connection, as the app makes one to the Worker: new handlers and server, and the Worker's client. */
  const link = async () => {
    let toClient: (text: string) => void = () => undefined
    const server = serveHost(hostHandlers(shell, downloads, chrome, () => ({ hostId: 'h', token: 't' }), () => undefined, copyIo), (text) => toClient(text))
    const client = makeHostClient((text) => {
      const parsed = parseFrame(text)
      if (parsed?.t === 'rpc') Effect.runFork(server.deliver(parsed.d))
    })
    toClient = (text) => {
      const parsed = parseFrame(text)
      if (parsed?.t === 'rpc') Effect.runFork(client.deliver(parsed.d))
    }
    const scope = Effect.runSync(Scope.make())
    const serving = Effect.runFork(Scope.provide(server.server, scope))
    const rpc = (await Effect.runPromise(Scope.provide(client.client, scope))) as unknown as Rpc
    return { rpc, serving, scope }
  }
  const end = (scope: Scope.Closeable) => Effect.runPromise(Scope.close(scope, { _tag: 'Success', value: undefined } as never))
  let current = await link()
  return {
    get rpc(): Rpc {
      return current.rpc
    },
    shell,
    downloads,
    ended,
    sandbox: shell.sandbox,
    /** The connection drops: the app interrupts its server, as HostLink does on a close; a call still pending gets no answer. */
    drop: () => Effect.runPromise(Fiber.interrupt(current.serving)),
    /** The same run of the app connects again: the Worker's calls go over the new connection. */
    reconnect: async () => {
      const old = current.scope
      current = await link()
      await end(old)
    },
    close: async () => {
      await end(current.scope)
      await shell.dispose()
    },
  }
}

/** An access a test names: the Robot "bot", workspace-write and no extra roots unless said otherwise. */
export const access = (change: Partial<HostAccess> = {}): HostAccess => ({ robot: 'bot', mode: 'workspace-write', roots: [], ...change })

let jobs = 0
/** A name for a job, the way the Worker names them: the Robot's id, a colon, and the job. */
export const jobName = (robot = 'bot'): string => `${robot}:j-${++jobs}`
