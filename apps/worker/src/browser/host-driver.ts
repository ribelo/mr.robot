/**
 * The Host browser (v1.2, hs-mqwd, hs-3wqx): Chrome on one of the Member's computers, reached
 * through the Mr. Robot app. The Robot DO gets a WebSocket that the host owner's Member DO relays
 * to the app, which pipes it to that Chrome's DevTools. Same tools as the cloud backends; the
 * profile on the host keeps its cookies (hs-43aj).
 */
import type { BrowserDriver, BrowserPage, BrowserState } from './driver.ts'
import { preparedPage, RenderingPage, socketBrowser } from './driver.ts'

export interface HostBrowserLink {
  /** A relay socket to the host's Chrome; fails with HostOffline when the host is not connected. */
  open(hostId: string): Promise<{ socket: WebSocket; session: string }>
  close(hostId: string, session: string): Promise<void>
}

export class HostDriver implements BrowserDriver {
  constructor(private readonly hostId: string, private readonly link: HostBrowserLink) {}

  async open(state: BrowserState | null): Promise<BrowserPage> {
    const { socket, session } = await this.link.open(this.hostId)
    const browser = await socketBrowser(socket)
    const page = await preparedPage(browser, state)
    return new RenderingPage(browser, page, state?.storage ?? {}, {
      id: `host:${this.hostId}:${session}`,
      // The tab closes; Chrome and its profile stay on the host.
      close: async () => {
        await page.close().catch(() => undefined)
        await this.link.close(this.hostId, session).catch(() => undefined)
      },
    })
  }

  /** A relay does not outlive the Robot's connection; a new one is opened instead. */
  async attach(): Promise<BrowserPage | undefined> {
    return undefined
  }
}
