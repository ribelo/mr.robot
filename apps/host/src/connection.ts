/**
 * The host's link to Mr. Robot (hs-ebba, hs-7dlt): device pairing, then one outbound WebSocket that
 * carries the RPC calls and a heartbeat with version, platform and capabilities. It reconnects with
 * a growing pause; close code 4001 means the host was unpaired.
 */
import { hostname, platform } from 'node:os'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { frame, HEARTBEAT_MS, parseFrame, serveHost } from '@mr-robot/host-protocol'
import WebSocket from 'ws'
import { findChrome, hasGraphicalSession, type HostChrome } from './chrome.ts'
import { hostHandlers } from './handlers.ts'

export type LinkState = 'unpaired' | 'pairing' | 'connecting' | 'online' | 'offline'

export interface LinkEvents {
  state(state: LinkState, detail?: string): void
  paired(hostId: string, token: string): void
  unpaired(): void
  sessions(count: number): void
}

export async function startPairing(server: string, name: string): Promise<{ code: string; approveUrl: string }> {
  const response = await fetch(`${server}/api/host/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, platform: platform() }) })
  if (!response.ok) throw new Error(`${server} answered ${response.status}: is this the address of a Mr. Robot server?`)
  return (await response.json()) as { code: string; approveUrl: string }
}

/** Wait until the Member approves the code in their browser; the token is handed over once. */
export async function waitForApproval(server: string, code: string, cancelled: () => boolean): Promise<{ hostId: string; token: string }> {
  while (!cancelled()) {
    const response = await fetch(`${server}/api/host/pair/poll?code=${encodeURIComponent(code)}`)
    const value = (await response.json()) as { status: string; hostId?: string; token?: string }
    if (value.status === 'paired' && value.hostId !== undefined && value.token !== undefined) return { hostId: value.hostId, token: value.token }
    if (value.status === 'expired') throw new Error('the pairing code expired; start again')
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('pairing cancelled')
}

export class HostLink {
  private socket: WebSocket | undefined
  private stopped = false
  private retry = 1000
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private server: Fiber.Fiber<never, never> | undefined

  constructor(
    private readonly target: { server: string; hostId: string; token: string; version: string },
    private readonly chrome: HostChrome,
    private readonly events: LinkEvents,
  ) {}

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.cleanup()
    this.socket?.close(1000)
  }

  private cleanup(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    if (this.server !== undefined) Effect.runFork(Fiber.interrupt(this.server))
    this.server = undefined
  }

  private beat(): void {
    this.socket?.send(frame({ t: 'hb', d: { version: this.target.version, platform: platform(), hostname: hostname(), capabilities: { graphical: hasGraphicalSession(), chrome: findChrome() } } }))
  }

  private connect(): void {
    if (this.stopped) return
    this.events.state('connecting')
    const url = `${this.target.server.replace(/^http/, 'ws')}/api/host/connect`
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.target.token}`, 'x-host-id': this.target.hostId } })
    this.socket = socket
    const handlers = hostHandlers(this.chrome, () => ({ hostId: this.target.hostId, token: this.target.token }), (count) => this.events.sessions(count))
    const host = serveHost(handlers, (text) => { if (socket.readyState === WebSocket.OPEN) socket.send(text) })
    socket.on('open', () => {
      this.retry = 1000
      this.server = Effect.runFork(host.server)
      this.beat()
      this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
      this.events.state('online')
    })
    socket.on('message', (data) => {
      const parsed = parseFrame(data.toString())
      if (parsed?.t === 'rpc') Effect.runFork(host.deliver(parsed.d))
    })
    socket.on('unexpected-response', (_request, response) => {
      // 401: the token is no longer valid (unpaired from the profile while this app was off).
      if (response.statusCode === 401) {
        this.stopped = true
        this.events.unpaired()
      }
    })
    socket.on('close', (code) => {
      this.cleanup()
      if (code === 4001) {
        this.stopped = true
        this.events.unpaired()
        return
      }
      if (this.stopped) return
      this.events.state('offline', code === 4000 ? 'replaced by another connection' : undefined)
      setTimeout(() => this.connect(), this.retry)
      this.retry = Math.min(this.retry * 2, 60_000)
    })
    socket.on('error', () => undefined)
  }
}
