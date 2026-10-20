/** Client and server of the Host protocol joined in this process, over the real handlers of the Host app. */
import * as Effect from 'effect/Effect'
import * as Scope from 'effect/Scope'
import { makeHostClient, parseFrame, serveHost, type CopyIo, type HostAccess, type JobEnded } from '@mr-robot/host-protocol'
import { hostHandlers } from '../src/handlers.ts'
import { HostShell } from '../src/shell.ts'

type Rpc = Record<string, (payload: unknown) => Effect.Effect<any, any>>

export async function connected(home: string, copyIo?: CopyIo, options: { readonly sandboxChain?: Parameters<typeof HostShell.start>[0]['sandboxChain'] } = {}) {
  const shell = await HostShell.start({ home, ...options })
  // The job frames the app would send to the Worker.
  const ended: JobEnded[] = []
  shell.onJobEnded((job) => ended.push(job))
  const chrome = { devtools: async () => { throw new Error('no Chrome here') } } as never
  let toClient: (text: string) => void = () => undefined
  const server = serveHost(hostHandlers(shell, chrome, () => ({ hostId: 'h', token: 't' }), () => undefined, copyIo), (text) => toClient(text))
  const client = makeHostClient((text) => {
    const parsed = parseFrame(text)
    if (parsed?.t === 'rpc') Effect.runFork(server.deliver(parsed.d))
  })
  toClient = (text) => {
    const parsed = parseFrame(text)
    if (parsed?.t === 'rpc') Effect.runFork(client.deliver(parsed.d))
  }
  const scope = Effect.runSync(Scope.make())
  Effect.runFork(Scope.provide(server.server, scope))
  const rpc = (await Effect.runPromise(Scope.provide(client.client, scope))) as unknown as Rpc
  return {
    rpc,
    shell,
    ended,
    sandbox: shell.sandbox,
    close: async () => {
      await Effect.runPromise(Scope.close(scope, { _tag: 'Success', value: undefined } as never))
      await shell.dispose()
    },
  }
}

/** An access a test names: the Robot "bot", workspace-write and no extra roots unless said otherwise. */
export const access = (change: Partial<HostAccess> = {}): HostAccess => ({ robot: 'bot', mode: 'workspace-write', roots: [], ...change })

let jobs = 0
/** A name for a job, the way the Worker names them: the Robot's id, a colon, and the job. */
export const jobName = (robot = 'bot'): string => `${robot}:j-${++jobs}`
