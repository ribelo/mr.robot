/**
 * A stub browser for Robot DO tests: one fixture shop with a login form. Cookies live in the
 * browser session, so only the Robot's saved state can carry a login into a new session.
 */
import type { BrowserAction, BrowserDriver, BrowserPage, BrowserSite, BrowserState } from '../src/browser/driver.ts'
import { onSiteDomain, StaleRef, withoutSite } from '../src/browser/driver.ts'
import type { Observation } from '../src/browser/observe.ts'

export const browserLog: string[] = []
export const cdpLog: Array<{ method: string; params?: Record<string, unknown> }> = []

/** Enough of a CDP session for the live view: records input, emits one frame per screencast start. */
class StubCdp {
  constructor(private readonly onTap: () => void = () => undefined) {}
  private listeners = new Map<string, Array<(event: unknown) => void>>()
  on(event: string, listener: (event: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  off(event: string, listener: (event: unknown) => void): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((entry) => entry !== listener))
  }
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    cdpLog.push({ method, ...(params === undefined ? {} : { params }) })
    if (method === 'Input.dispatchMouseEvent' && params?.['type'] === 'mouseReleased') this.onTap()
    if (method === 'Page.startScreencast') {
      queueMicrotask(() => {
        for (const listener of this.listeners.get('Page.screencastFrame') ?? []) listener({ data: 'AAAA', sessionId: 1, metadata: { deviceWidth: 1280, deviceHeight: 800 } })
      })
    }
    return {}
  }
}

/**
 * A service's sign-in page (v1.12 ticket 11): a tap on a page open at the start URL signs the person in,
 * leaving the given page, cookies and localStorage in the browser. Set by a test.
 */
export const signIns = new Map<string, { readonly url: string; readonly cookies: ReadonlyArray<Record<string, unknown>>; readonly storage: Readonly<Record<string, Readonly<Record<string, string>>>> }>()

/** Sessions left running between Turns, by id (the stub's Browser Rendering). */
export const runningSessions = new Map<string, StubPage>()

/** Which backend each open went to, in order (rb-wgtd). */
export const backendLog: string[] = []

export class StubDriver implements BrowserDriver {
  constructor(private readonly backend = 'browser-run') {}

  async open(state: BrowserState | null): Promise<BrowserPage> {
    browserLog.push('open')
    backendLog.push(this.backend)
    return new StubPage(state)
  }

  async attach(sessionId: string): Promise<BrowserPage | undefined> {
    browserLog.push('attach')
    return runningSessions.get(sessionId)
  }
}

export class StubPage implements BrowserPage {
  private readonly id = `session-${crypto.randomUUID()}`
  /** A test puts what a page would show here. */
  readonly shown: Array<{ title: string; body: string; at: number }> = []

  constructor(stateArg: BrowserState | null, _unused?: undefined) {
    this.cookies = [...(stateArg?.cookies ?? [])]
    this.storage = { ...(stateArg?.storage ?? {}) }
    runningSessions.set(this.id, this)
  }

  sessionId(): string {
    return this.id
  }

  async detach(): Promise<void> {
    browserLog.push('detach')
  }

  async takeNotifications(): Promise<Array<{ title: string; body: string; at: number }>> {
    return this.shown.splice(0)
  }

  private current = 'about:blank'
  private cookies: Array<Record<string, unknown>>
  private storage: Record<string, Readonly<Record<string, string>>>
  private typed = ''
  private shots = 0


  private get loggedIn(): boolean {
    return this.cookies.some((cookie) => cookie['name'] === 'session' && cookie['value'] === 'ok')
  }

  async goto(url: string): Promise<void> {
    browserLog.push(`goto:${url}`)
    this.current = url
  }

  async observe(): Promise<Observation> {
    if (this.current.endsWith('/blocked')) {
      // What a bot-protected shop answers (Allegro's DataDome page).
      return { url: this.current, title: 'allegro.pl', text: 'You have been blocked.\nAccess to this page has been denied.', canScrollUp: false, canScrollDown: false, challenge: null, blocked: true, elements: [] }
    }
    if (this.current.endsWith('/checkout-step-two')) {
      return {
        url: this.current, title: 'Swag Labs', text: 'Checkout: Overview', canScrollUp: false, canScrollDown: false, challenge: null,
        elements: [{ index: 1, role: 'button', label: 'Cancel', value: '', operations: ['CLICK'] }, { index: 2, role: 'button', label: 'Finish', value: '', operations: ['CLICK'] }],
      }
    }
    if (this.current.endsWith('/checkout')) {
      return {
        url: this.current, title: 'Shop: checkout', text: 'Cart: 1 item, 49 PLN', canScrollUp: false, canScrollDown: false, challenge: null,
        elements: [
          { index: 1, role: 'button', label: 'Change address', value: '', operations: ['CLICK'] },
          { index: 2, role: 'button', label: 'Kupuję i płacę', value: '', operations: ['CLICK'] },
        ],
      }
    }
    if (this.current.endsWith('/login') && !this.loggedIn) {
      return {
        url: this.current, title: 'Shop: sign in', text: 'Sign in to the shop', canScrollUp: false, canScrollDown: false, challenge: null,
        elements: [
          { index: 1, role: 'password', label: 'Password', value: this.typed === '' ? '' : '••••', operations: ['TYPE_TEXT', 'CLICK'] },
          { index: 2, role: 'button', label: 'Sign in', value: '', operations: ['CLICK'] },
        ],
      }
    }
    return {
      url: this.current, title: 'Shop', text: this.loggedIn ? 'Hello, signed-in customer. Cart: 0 items' : 'Welcome, guest', canScrollUp: false, canScrollDown: true, challenge: null,
      elements: [{ index: 1, role: 'button', label: 'Add to cart', value: '', operations: ['CLICK'] }],
    }
  }

  async act(action: BrowserAction): Promise<void> {
    browserLog.push(`act:${action.action}`)
    if (action.action === 'type' && action.index === 1) this.typed = action.text
    else if (action.action === 'click' && action.index === 2 && this.current.endsWith('/login')) {
      if (this.typed === 'right-password') {
        this.cookies.push({ name: 'session', value: 'ok', domain: 'shop.test' })
        this.current = 'https://shop.test/'
      }
    } else if (action.action === 'click' && action.index > 2) {
      throw new StaleRef(action.index)
    }
  }

  async fillLogin(_username: string, password: string): Promise<{ username: boolean; password: boolean }> {
    browserLog.push('fill')
    if (!this.current.endsWith('/login') || this.loggedIn) return { username: false, password: false }
    this.typed = password
    return { username: false, password: true }
  }

  async waitFor(): Promise<void> {}

  async screenshot(): Promise<Uint8Array> {
    this.shots += 1
    // A PNG signature and IHDR (1280×800), then the shot number.
    const png = new Uint8Array(33)
    png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
    new DataView(png.buffer).setUint32(16, 1280)
    new DataView(png.buffer).setUint32(20, 800)
    png[32] = this.shots
    return png
  }

  url(): string {
    return this.current
  }

  async exportState(): Promise<BrowserState> {
    return { cookies: this.cookies, storage: this.storage }
  }

  async readSite(site: BrowserSite): Promise<BrowserState> {
    browserLog.push(`read:${site.domain}`)
    return { cookies: this.cookies.filter((cookie) => onSiteDomain(String(cookie['domain'] ?? ''), site.domain)), storage: Object.fromEntries(site.origins.map((origin) => [origin, this.storage[origin] ?? {}])) }
  }

  async forgetSite(site: BrowserSite): Promise<void> {
    browserLog.push(`forget:${site.domain}`)
    const kept = withoutSite({ cookies: this.cookies, storage: this.storage }, site.domain)
    this.cookies = [...kept.cookies]
    this.storage = { ...kept.storage }
  }

  /** A tap on a sign-in page signs the person in (see signIns). */
  private tapped(): void {
    const signIn = signIns.get(this.current)
    if (signIn === undefined) return
    this.current = signIn.url
    // A cookie of the same name and domain is replaced, as a browser does.
    const same = (a: Record<string, unknown>, b: Record<string, unknown>) => a['name'] === b['name'] && a['domain'] === b['domain']
    this.cookies = [...this.cookies.filter((cookie) => !signIn.cookies.some((fresh) => same(cookie, fresh))), ...signIn.cookies]
    this.storage = { ...this.storage, ...signIn.storage }
  }

  private stubCdp = new StubCdp(() => this.tapped())

  async cdp() {
    return this.stubCdp as never
  }

  async close(): Promise<void> {
    browserLog.push('close')
    runningSessions.delete(this.id)
  }
}
