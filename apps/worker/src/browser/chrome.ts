/**
 * Chrome in a Cloudflare Container (v1.1 ticket 02, rb-wn96): one container per Robot browser
 * session, no Web Bot Auth signature. The image (infra/chrome/image.nix) runs headless Chrome
 * with DevTools on port 9222; with WG_CONFIG set its traffic goes through the Home's VPN (ticket 03).
 */
import { Container } from '@cloudflare/containers'
import type { Env } from '../env.ts'

export class ChromeContainer extends Container<Env> {
  override defaultPort = 9222
  /** The container sleeps when nothing reaches it for this long (the Robot also stops it at the end of a Turn). */
  override sleepAfter = '5m'

  /** Start Chrome; WG_CONFIG routes it through the VPN, PROXY_URL through a proxy (v1.2 ticket 05). */
  async begin(envVars: Record<string, string>): Promise<void> {
    await this.startAndWaitForPorts({ ports: 9222, startOptions: { envVars } })
  }

  async running(): Promise<boolean> {
    return this.ctx.container?.running === true
  }

  async end(): Promise<void> {
    await this.stop().catch(() => undefined)
  }
}
