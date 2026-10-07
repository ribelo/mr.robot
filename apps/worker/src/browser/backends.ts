/**
 * Browser backends (rb-wgtd, rb-4n0b, rb-y50l): where a Robot's Chrome runs. Everything above
 * the BrowserDriver seam (tools, cookies and storage, screenshots, live view, takeover) is the
 * same for all of them; a backend supplies a CDP Chrome and the price of its time.
 */
import type { BrowserBackend, BrowserBackendOption } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { ContainerDriver, RenderingDriver, type BrowserDriver } from './driver.ts'

export interface BackendInfo {
  readonly label: string
  readonly note: string
  /** USD per browser hour, for usage and spend limits. */
  readonly hourlyUsd: number
}

export const BACKENDS: Record<BrowserBackend, BackendInfo> = {
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
}

export const BROWSER_BACKENDS = Object.keys(BACKENDS) as BrowserBackend[]

/** Which backends this deployment can run. */
export function backendOptions(env: Env, vpnConfigured: boolean): BrowserBackendOption[] {
  const container = (env as { CHROME?: unknown }).CHROME !== undefined
  return BROWSER_BACKENDS.map((id) => {
    const available = id === 'browser-run' || (container && (id === 'container' || vpnConfigured))
    const why = id === 'browser-run' ? '' : !container ? ' Not deployed in this Home yet.' : id === 'container-vpn' && !vpnConfigured ? ' Needs the Home\'s Proton VPN configuration.' : ''
    return { id, label: BACKENDS[id].label, note: BACKENDS[id].note + why, available }
  })
}

export class BackendUnavailable extends Error {}

/** The driver for a backend in this deployment; a container session is named per Robot and backend. */
export function driverFor(backend: BrowserBackend, env: Env, robot: { id: string; vpnConfig: () => Promise<string | null> }): BrowserDriver {
  if (backend === 'browser-run') return new RenderingDriver(env.BROWSER)
  const chrome = (env as { CHROME?: { getByName(name: string): never } }).CHROME
  if (chrome === undefined) throw new BackendUnavailable(`${BACKENDS[backend].label} is not deployed in this Home yet; choose Browser Run in this Robot's Advanced settings.`)
  return new ContainerDriver(chrome, `${backend}:${robot.id}`, backend === 'container' ? async () => null : async () => {
    const config = await robot.vpnConfig()
    if (config === null) throw new BackendUnavailable('Container Chrome via VPN needs the Home\'s Proton VPN configuration (Admin → Home settings).')
    return config
  })
}

/** The cost of browser time on a backend. */
export function browserCost(backend: BrowserBackend, ms: number): number {
  return (ms / 3_600_000) * BACKENDS[backend].hourlyUsd
}
