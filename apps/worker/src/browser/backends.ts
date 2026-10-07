/**
 * Browser backends (rb-wgtd, rb-4n0b, rb-y50l, hs-mqwd): where a Robot's Chrome runs. Everything
 * above the BrowserDriver seam (tools, cookies and storage, screenshots, live view, takeover) is the
 * same for all of them; a backend supplies a CDP Chrome and the price of its time. Cloud backends
 * are fixed; a Host browser ("host:<id>") is the Chrome on one of the Member's computers.
 */
import type { BrowserBackend, BrowserBackendOption, HostView } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { ContainerDriver, RenderingDriver, type BrowserDriver } from './driver.ts'
import { HostDriver, type HostBrowserLink } from './host-driver.ts'

export interface BackendInfo {
  readonly label: string
  readonly note: string
  /** USD per browser hour, for usage and spend limits. */
  readonly hourlyUsd: number
}

export type CloudBackend = 'browser-run' | 'container' | 'container-vpn' | 'container-proxy'

export const BACKENDS: Record<CloudBackend, BackendInfo> = {
  'browser-run': {
    label: 'Browser Run',
    note: 'Cloudflare Browser Rendering. Its requests carry Cloudflare\'s Web Bot Auth signature and come from Cloudflare addresses, so sites with bot protection may block it.',
    // Workers Paid: $0.09 per browser hour beyond the included hours.
    hourlyUsd: 0.09,
  },
  container: {
    label: 'Container Chrome',
    note: 'Chrome in a Cloudflare Container: no bot signature, Cloudflare addresses.',
    // A standard container (1 vCPU, 4 GiB): $0.000020 per vCPU-second + $0.0000025 per GiB-second.
    hourlyUsd: 0.108,
  },
  'container-vpn': {
    label: 'Container Chrome via VPN',
    note: 'Container Chrome whose traffic goes through the Home\'s Proton VPN (a Polish address).',
    hourlyUsd: 0.108,
  },
  'container-proxy': {
    label: 'Container Chrome via proxy',
    note: 'Container Chrome whose traffic goes through the proxy address stored for the Home (for example a residential provider); proxy traffic is billed by the provider.',
    hourlyUsd: 0.108,
  },
}

export const CLOUD_BACKENDS = Object.keys(BACKENDS) as CloudBackend[]

export function isHostBackend(backend: BrowserBackend): backend is `host:${string}` {
  return backend.startsWith('host:')
}

export function hostIdOf(backend: `host:${string}`): string {
  return backend.slice('host:'.length)
}

/** A backend's label; a Host browser is named after its host. */
export function backendLabel(backend: BrowserBackend, hosts: readonly Pick<HostView, 'id' | 'name'>[] = []): string {
  if (isHostBackend(backend)) return `Host browser: ${hosts.find((host) => host.id === hostIdOf(backend))?.name ?? hostIdOf(backend)}`
  return BACKENDS[backend].label
}

/** Which backends this deployment can run, including the browsers of the hosts the Member reaches. */
export function backendOptions(env: Env, configured: { vpn: boolean; proxy: boolean }, hosts: readonly HostView[] = []): BrowserBackendOption[] {
  const container = (env as { CHROME?: unknown }).CHROME !== undefined
  const cloud = CLOUD_BACKENDS.map((id): BrowserBackendOption => {
    const needs = id === 'container-vpn' ? configured.vpn : id === 'container-proxy' ? configured.proxy : true
    const available = id === 'browser-run' || (container && needs)
    const why = id === 'browser-run' ? '' : !container ? ' Not deployed in this Home yet.' : id === 'container-vpn' && !configured.vpn ? ' Needs the Home\'s Proton VPN configuration.' : id === 'container-proxy' && !configured.proxy ? ' Needs a proxy address under Admin → Proxy.' : ''
    return { id, label: BACKENDS[id].label, note: BACKENDS[id].note + why, available }
  })
  const own = hosts.map((host): BrowserBackendOption => {
    const usable = host.capabilities?.chrome !== null && host.capabilities?.chrome !== undefined && host.capabilities.graphical
    const state = !host.online ? ` It is offline now (last seen ${host.lastSeen === null ? 'never' : new Date(host.lastSeen).toISOString().slice(0, 16).replace('T', ' ')} UTC); a Robot on it reports that instead of using a cloud browser.` : !usable ? ' It has no Chrome or no graphical session, so it offers files and shell only.' : ''
    return { id: `host:${host.id}`, label: `Host browser: ${host.name}`, note: `Chrome on ${host.ownerName}'s computer "${host.name}", with its own Mr. Robot profile and a home connection.${state}`, available: usable }
  })
  return [...cloud, ...own]
}

export class BackendUnavailable extends Error {}

export interface DriverContext {
  readonly id: string
  readonly vpnConfig: () => Promise<string | null>
  readonly proxyConfig: () => Promise<string | null>
  /** Opens a CDP relay to a host's Chrome (through the host owner's Member DO). */
  readonly hostBrowser: HostBrowserLink
}

/** The driver for a backend in this deployment; a container session is named per Robot and backend. */
export function driverFor(backend: BrowserBackend, env: Env, robot: DriverContext): BrowserDriver {
  if (backend === 'browser-run') return new RenderingDriver(env.BROWSER)
  if (isHostBackend(backend)) return new HostDriver(hostIdOf(backend), robot.hostBrowser)
  const chrome = (env as { CHROME?: { getByName(name: string): never } }).CHROME
  if (chrome === undefined) throw new BackendUnavailable(`${BACKENDS[backend].label} is not deployed in this Home yet; choose Browser Run in this Robot's Advanced settings.`)
  return new ContainerDriver(chrome, `${backend}:${robot.id}`, async (): Promise<Record<string, string>> => {
    if (backend === 'container') return {}
    if (backend === 'container-vpn') {
      const config = await robot.vpnConfig()
      if (config === null) throw new BackendUnavailable('Container Chrome via VPN needs the Home\'s Proton VPN configuration (Admin → Proton VPN).')
      return { WG_CONFIG: config }
    }
    const proxy = await robot.proxyConfig()
    if (proxy === null) throw new BackendUnavailable('Container Chrome via proxy needs a proxy address (Admin → Proxy).')
    return { PROXY_URL: proxy }
  })
}

/** The cost of browser time on a backend; a host's own Chrome costs nothing. */
export function browserCost(backend: BrowserBackend, ms: number): number {
  return isHostBackend(backend) ? 0 : (ms / 3_600_000) * BACKENDS[backend].hourlyUsd
}
