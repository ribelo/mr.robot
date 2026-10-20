/**
 * Browser backends (rb-wgtd, hs-mqwd, ob-myzd): where a Robot's Chrome runs. Everything above the
 * BrowserDriver seam (tools, cookies and storage, screenshots, live view, takeover) is the same for
 * both; a backend supplies a CDP Chrome and the price of its time. Two exist: Browser Rendering in
 * the cloud, and a Host browser ("host:<id>"), the Chrome on one of the Member's computers.
 */
import type { BrowserBackend, BrowserBackendOption, HostView } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { RenderingDriver, type BrowserDriver } from './driver.ts'
import { HostDriver, type HostBrowserLink } from './host-driver.ts'

export interface BackendInfo {
  readonly label: string
  readonly note: string
  /** USD per browser hour, for usage and spend limits. */
  readonly hourlyUsd: number
}

export const BROWSER_RUN: BackendInfo = {
  label: 'Browser Run',
  note: 'Cloudflare Browser Rendering. Its requests carry Cloudflare\'s Web Bot Auth signature and come from Cloudflare addresses, so sites with bot protection may block it.',
  // Workers Paid: $0.09 per browser hour beyond the included hours.
  hourlyUsd: 0.09,
}

export function isHostBackend(backend: BrowserBackend): backend is `host:${string}` {
  return backend.startsWith('host:')
}

export function hostIdOf(backend: `host:${string}`): string {
  return backend.slice('host:'.length)
}

/** A backend's label; a Host browser is named after its host. */
export function backendLabel(backend: BrowserBackend, hosts: readonly Pick<HostView, 'id' | 'name'>[] = []): string {
  if (isHostBackend(backend)) return `Host browser: ${hosts.find((host) => host.id === hostIdOf(backend))?.name ?? hostIdOf(backend)}`
  return BROWSER_RUN.label
}

/** What a Robot suggests to its owner when a site blocks its browser: the other of the two (ob-myzd). */
export function otherBrowser(backend: BrowserBackend): string {
  return isHostBackend(backend) ? BROWSER_RUN.label : 'a Host browser'
}

/** Which backends this Member can choose: Browser Run, and the browsers of the hosts the Member reaches. */
export function backendOptions(hosts: readonly HostView[] = []): BrowserBackendOption[] {
  const cloud: BrowserBackendOption = { id: 'browser-run', label: BROWSER_RUN.label, note: BROWSER_RUN.note, available: true }
  const own = hosts.map((host): BrowserBackendOption => {
    const usable = host.capabilities?.chrome !== null && host.capabilities?.chrome !== undefined && host.capabilities.graphical
    const state = !host.online ? ` It is offline now (last seen ${host.lastSeen === null ? 'never' : new Date(host.lastSeen).toISOString().slice(0, 16).replace('T', ' ')} UTC); a Robot on it reports that instead of using a cloud browser.` : !usable ? ' It has no Chrome or no graphical session, so it offers files and shell only.' : ''
    return { id: `host:${host.id}`, label: `Host browser: ${host.name}`, note: `Chrome on ${host.ownerName}'s computer "${host.name}", with its own Mr. Robot profile and a home connection.${state}`, available: usable }
  })
  return [cloud, ...own]
}

/** The driver for a backend in this deployment. */
export function driverFor(backend: BrowserBackend, env: Env, hostBrowser: HostBrowserLink): BrowserDriver {
  return isHostBackend(backend) ? new HostDriver(hostIdOf(backend), hostBrowser) : new RenderingDriver(env.BROWSER)
}

/** The cost of browser time on a backend; a host's own Chrome costs nothing. */
export function browserCost(backend: BrowserBackend, ms: number): number {
  return isHostBackend(backend) ? 0 : (ms / 3_600_000) * BROWSER_RUN.hourlyUsd
}
