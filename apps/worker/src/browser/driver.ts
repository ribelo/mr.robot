/**
 * The browser a Robot uses (robot-0eew): Cloudflare Browser Rendering through
 * @cloudflare/puppeteer. The driver is a seam so tests use a stub browser.
 */
import puppeteer, { type Browser, type CDPSession, type Page } from '@cloudflare/puppeteer'
import { OBSERVE_SCRIPT, type Observation } from './observe.ts'

/** Cookies and per-origin localStorage, kept in the Robot DO between sessions (robot-t0vc). */
export interface BrowserState {
  readonly cookies: ReadonlyArray<Record<string, unknown>>
  readonly storage: Readonly<Record<string, Readonly<Record<string, string>>>>
}

export type BrowserAction =
  | { readonly action: 'click'; readonly index: number }
  | { readonly action: 'type'; readonly index: number; readonly text: string; readonly submit?: boolean }
  | { readonly action: 'select'; readonly index: number; readonly option: string }
  | { readonly action: 'check'; readonly index: number; readonly checked: boolean }
  | { readonly action: 'press'; readonly key: string }
  | { readonly action: 'scroll'; readonly direction: 'up' | 'down' }

export interface BrowserPage {
  goto(url: string): Promise<void>
  observe(): Promise<Observation>
  act(action: BrowserAction): Promise<void>
  waitFor(input: { text?: string; ms?: number }): Promise<void>
  screenshot(): Promise<Uint8Array>
  url(): string
  exportState(): Promise<BrowserState>
  /** Raw CDP for the live view and takeover. */
  cdp(): Promise<CDPSession | undefined>
  close(): Promise<void>
  /** The Browser Rendering session, to reconnect between Turns (robot-lulc). */
  sessionId(): string
  /** Leave the browser running and drop this Worker's connection to it. */
  detach(): Promise<void>
  /** Notifications pages showed since the last call (Notification and showNotification). */
  takeNotifications(): Promise<Array<{ title: string; body: string; at: number }>>
  /** Type a username and password into the page's login fields (ticket 05). */
  fillLogin(username: string, password: string): Promise<{ username: boolean; password: boolean }>
}

export interface BrowserDriver {
  open(state: BrowserState | null): Promise<BrowserPage>
  /** Reconnect to a session left running; undefined when it has ended. */
  attach(sessionId: string): Promise<BrowserPage | undefined>
}

export class StaleRef extends Error {
  constructor(index: number) {
    super(`element [${index}] is gone or changed; call browser_observe and use a fresh index`)
    this.name = 'StaleRef'
  }
}

export class RenderingDriver implements BrowserDriver {
  constructor(private readonly binding: Fetcher) {}

  async open(state: BrowserState | null): Promise<BrowserPage> {
    const browser = await puppeteer.launch(this.binding as never, { keep_alive: 600_000 })
    return new RenderingPage(browser, await preparedPage(browser, state), state?.storage ?? {})
  }

  async attach(sessionId: string): Promise<BrowserPage | undefined> {
    try {
      const browser = await puppeteer.connect(this.binding as never, sessionId)
      // A launched browser keeps its initial blank tab; the Robot's page is the one with an address.
      const pages = await browser.pages()
      const page = pages.filter((candidate) => candidate.url() !== 'about:blank').at(-1) ?? pages.at(-1)
      if (page === undefined) {
        await browser.close().catch(() => undefined)
        return undefined
      }
      await rearmed(page)
      return new RenderingPage(browser, page, {})
    } catch {
      return undefined
    }
  }
}

/** A new tab with the Robot's cookies, storage and notification capture. */
export async function preparedPage(browser: Browser, state: BrowserState | null, mark: (name: string) => void = () => undefined): Promise<Page> {
  const page = await browser.newPage()
  mark('page.new')
  await page.setViewport({ width: 1280, height: 800 })
  mark('page.viewport')
  await page.evaluateOnNewDocument(NOTIFICATION_CAPTURE)
  mark('page.capture')
  if (state !== null) {
    if (state.cookies.length > 0) {
      // One CDP call for all cookies: puppeteer's setCookie costs a round trip each, seconds over a relay (pl-n2vs).
      const cookies = (state.cookies as Array<Record<string, unknown>>).map((cookie) => Object.fromEntries(
        ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expires', 'priority', 'sameParty', 'sourceScheme', 'partitionKey']
          .filter((key) => cookie[key] !== undefined && !(key === 'expires' && Number(cookie[key]) < 0))
          .map((key) => [key, cookie[key]]),
      ))
      const session = await page.createCDPSession()
      try {
        await session.send('Network.setCookies', { cookies } as never)
      } catch {
        await page.setCookie(...(state.cookies as never[]))
      } finally {
        await session.detach().catch(() => undefined)
      }
    }
    mark(`page.cookies(${state.cookies.length})`)
    await page.evaluateOnNewDocument(`(() => {
      const saved = (${JSON.stringify(state.storage)})[location.origin]
      if (saved === undefined || sessionStorage.getItem('__mr_restored') === '1') return
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value)
      sessionStorage.setItem('__mr_restored', '1')
    })()`)
  }
  return page
}

/**
 * Scripts registered for new documents end with the connection that registered them: install
 * the notification capture again for later navigations, and in the page already open.
 */
export async function rearmed(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(NOTIFICATION_CAPTURE)
  await page.evaluate(NOTIFICATION_CAPTURE).catch(() => undefined)
}

/** The Chrome container's DevTools, as a puppeteer transport over the Worker's WebSocket. */
async function containerBrowser(stub: ChromeStub): Promise<Browser> {
  const version = (await (await stub.fetch('http://localhost/json/version')).json()) as { webSocketDebuggerUrl: string }
  const path = new URL(version.webSocketDebuggerUrl).pathname
  const response = await stub.fetch(new Request(`http://localhost${path}`, { headers: { Upgrade: 'websocket' } }))
  const socket = response.webSocket
  if (socket === null) throw new Error(`the browser container refused DevTools (${response.status})`)
  return socketBrowser(socket)
}

/** A browser-level DevTools WebSocket as a puppeteer Browser (containers, host relays). */
export async function socketBrowser(socket: WebSocket): Promise<Browser> {
  socket.accept()
  const transport: { send(message: string): void; close(): void; onmessage?: (message: string) => void; onclose?: () => void } = {
    send: (message) => socket.send(message),
    close: () => socket.close(),
  }
  socket.addEventListener('message', (event) => transport.onmessage?.(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)))
  socket.addEventListener('close', () => transport.onclose?.())
  return (await puppeteer.connect({ transport } as never)) as unknown as Browser
}

type ChromeStub = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response>; begin(envVars: Record<string, string>): Promise<void>; running(): Promise<boolean>; end(): Promise<void> }

/**
 * Container Chrome (rb-wn96): one container per Robot and backend; its session id is the
 * container's name, so a session left running is reattached by name. Closing stops the container.
 */
/** Where the last container open spent its time, in ms from its start (pl-n2vs). */
export const containerOpenStages: Record<string, number> = {}

/** Leave a warm container with one blank tab: no page keeps loading or holding state between uses. */
async function closeTabs(browser: Browser): Promise<void> {
  const pages = await browser.pages().catch(() => [])
  const blank = await browser.newPage().catch(() => undefined)
  for (const page of pages) if (page !== blank) await page.close().catch(() => undefined)
}

export class ContainerDriver implements BrowserDriver {
  constructor(
    private readonly chrome: { getByName(name: string): ChromeStub },
    private readonly name: string,
    private readonly startEnv: () => Promise<Record<string, string>>,
  ) {}

  async open(state: BrowserState | null): Promise<BrowserPage> {
    const t0 = Date.now()
    const mark = (name: string) => { containerOpenStages[name] = Date.now() - t0 }
    for (const key of Object.keys(containerOpenStages)) delete containerOpenStages[key]
    const stub = this.chrome.getByName(this.name)
    // A container still running from the last open is reused: no boot, no VPN handshake (pl-n2vs).
    const warm = await stub.running()
    mark(warm ? 'running-check(warm)' : 'running-check(cold)')
    if (!warm) await stub.begin(await this.startEnv())
    mark('container')
    const browser = await containerBrowser(stub)
    mark('devtools')
    const page = await preparedPage(browser, state, mark)
    mark('page')
    // Closing closes the tab only; the container sleeps by itself after a few idle minutes (ChromeContainer.sleepAfter).
    return new RenderingPage(browser, page, state?.storage ?? {}, { id: this.name, close: () => closeTabs(browser) })
  }

  async attach(sessionId: string): Promise<BrowserPage | undefined> {
    if (sessionId !== this.name) return undefined
    const stub = this.chrome.getByName(sessionId)
    try {
      if (!(await stub.running())) return undefined
      const browser = await containerBrowser(stub)
      const pages = await browser.pages()
      const page = pages.filter((candidate) => candidate.url() !== 'about:blank').at(-1) ?? pages.at(-1)
      if (page === undefined) return undefined
      await rearmed(page)
      return new RenderingPage(browser, page, {}, { id: sessionId, close: () => closeTabs(browser) })
    } catch {
      return undefined
    }
  }
}

/**
 * Runs in every page: grants notification permission and records what the page shows, so the
 * Robot can be woken by it. Pages see a granted permission; nothing is displayed.
 */
const NOTIFICATION_CAPTURE = `(() => {
  const seen = (window.__mrNotifications = window.__mrNotifications || [])
  const record = (title, options) => seen.push({ title: String(title || ''), body: String((options && options.body) || ''), at: Date.now() })
  const Fake = function (title, options) { record(title, options); return { close() {}, addEventListener() {}, removeEventListener() {} } }
  Fake.permission = 'granted'
  Fake.requestPermission = (callback) => { if (callback) callback('granted'); return Promise.resolve('granted') }
  try { Object.defineProperty(window, 'Notification', { value: Fake, configurable: true, writable: true }) } catch {}
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) { record(title, options); return Promise.resolve() }
  }
})()`

export class RenderingPage implements BrowserPage {
  private cdpSession: CDPSession | undefined
  private readonly storage: Record<string, Readonly<Record<string, string>>>

  constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    storage: Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** A container session: its own id, and closing stops the container. */
    private readonly session?: { readonly id: string; close(): Promise<void> },
  ) {
    this.storage = { ...storage }
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await this.settle()
  }

  async observe(): Promise<Observation> {
    return bounded(this.page.evaluate(OBSERVE_SCRIPT) as Promise<Observation>, 20_000, 'the page did not answer within 20 seconds; it may be stuck, try browser_wait or open it again')
  }

  async act(action: BrowserAction): Promise<void> {
    // A hung page must fail the call, not stall the Robot's Turn (seen on saucedemo.com, 2026-10-07).
    return bounded(this.actNow(action), 30_000, `the page did not respond to the ${action.action} within 30 seconds; observe it again`)
  }

  private async actNow(action: BrowserAction): Promise<void> {
    if (action.action === 'press') {
      await this.page.keyboard.press(action.key as never)
    } else if (action.action === 'scroll') {
      await this.page.evaluate(`window.scrollBy({ top: ${action.direction === 'down' ? 560 : -560} })`)
    } else {
      const handle = await this.page.$(`[data-mr-ref="${action.index}"]`)
      if (handle === null) throw new StaleRef(action.index)
      switch (action.action) {
        case 'click':
          await handle.click()
          break
        case 'type':
          await handle.click({ clickCount: 3 })
          await this.page.evaluate(`(() => { const el = document.querySelector('[data-mr-ref="${action.index}"]'); if (el && 'value' in el) el.value = '' })()`)
          await handle.type(action.text, { delay: 10 })
          if (action.submit === true) await this.page.keyboard.press('Enter')
          break
        case 'select': {
          const value = await this.page.evaluate(`(() => {
            const el = document.querySelector('[data-mr-ref="${action.index}"]')
            if (!el || el.tagName !== 'SELECT') return null
            const wanted = ${JSON.stringify(action.option)}
            const option = [...el.options].find((entry) => entry.value === wanted || entry.innerText.trim() === wanted)
            return option ? option.value : null
          })()`) as string | null
          if (value === null) throw new Error(`no option "${action.option}"`)
          await handle.select(value)
          break
        }
        case 'check': {
          const checked = await this.page.evaluate(`(() => { const el = document.querySelector('[data-mr-ref="${action.index}"]'); return !!el && (el.checked === true || el.getAttribute('aria-checked') === 'true') })()`)
          if (checked !== action.checked) await handle.click()
          break
        }
      }
    }
    await this.settle()
  }

  async waitFor(input: { text?: string; ms?: number }): Promise<void> {
    if (input.text !== undefined) {
      await this.page.waitForFunction(`document.body && document.body.innerText.includes(${JSON.stringify(input.text)})`, { timeout: Math.min(input.ms ?? 30_000, 60_000) })
    } else {
      await new Promise((resolve) => setTimeout(resolve, Math.min(input.ms ?? 1000, 30_000)))
    }
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array(await this.page.screenshot({ type: 'png' }) as Uint8Array)
  }

  url(): string {
    return this.page.url()
  }

  async exportState(): Promise<BrowserState> {
    const session = await this.page.createCDPSession()
    const { cookies } = await session.send('Network.getAllCookies') as unknown as { cookies: Record<string, unknown>[] }
    const origin = await this.page.evaluate('location.origin').catch(() => 'null') as string
    if (origin !== 'null') {
      const local = await this.page.evaluate('Object.fromEntries(Object.entries(localStorage))').catch(() => ({}))
      this.storage[origin] = local as Record<string, string>
    }
    return { cookies, storage: this.storage }
  }

  async cdp(): Promise<CDPSession | undefined> {
    this.cdpSession ??= await this.page.createCDPSession()
    return this.cdpSession
  }

  async close(): Promise<void> {
    if (this.session === undefined) await this.browser.close().catch(() => undefined)
    else {
      await this.session.close()
      await this.browser.disconnect().catch(() => undefined)
    }
  }

  sessionId(): string {
    return this.session?.id ?? this.browser.sessionId()
  }

  async fillLogin(username: string, password: string): Promise<{ username: boolean; password: boolean }> {
    // Mark the visible password field and the username field before it (or an email/username field).
    const found = (await this.page.evaluate(LOGIN_FIELDS)) as { username: boolean; password: boolean }
    const type = async (selector: string, value: string) => {
      const handle = await this.page.$(selector)
      if (handle === null) return false
      await handle.click({ clickCount: 3 })
      await this.page.evaluate(`(() => { const el = document.querySelector('${selector}'); if (el) el.value = '' })()`)
      await handle.type(value, { delay: 15 })
      return true
    }
    const result = {
      username: found.username && username !== '' ? await type('[data-mr-fill="u"]', username) : false,
      password: found.password ? await type('[data-mr-fill="p"]', password) : false,
    }
    await this.page.evaluate(`document.querySelectorAll('[data-mr-fill]').forEach((el) => el.removeAttribute('data-mr-fill'))`)
    return result
  }

  async detach(): Promise<void> {
    await this.browser.disconnect().catch(() => undefined)
  }

  async takeNotifications(): Promise<Array<{ title: string; body: string; at: number }>> {
    // Every tab of the session: a page the Robot left in another tab may be the one that notifies.
    const pages = await this.browser.pages().catch(() => [this.page])
    const found = await Promise.all(pages.map((page) => page.evaluate('(window.__mrNotifications || []).splice(0)').catch(() => []) as Promise<Array<{ title: string; body: string; at: number }>>))
    return found.flat().sort((a, b) => a.at - b.at)
  }


  /** Give the page a moment to react: a short network quiet period, bounded. */
  private async settle(): Promise<void> {
    await Promise.race([
      this.page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ])
  }
}

/** Reject when the work takes too long; the work itself is abandoned. */
function bounded<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/** Finds the login form's fields: the visible password input and the username input that goes with it. */
const LOGIN_FIELDS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled }
  document.querySelectorAll('[data-mr-fill]').forEach((el) => el.removeAttribute('data-mr-fill'))
  const password = [...document.querySelectorAll('input[type=password]')].find(visible)
  const scope = (password && password.form) || document
  const inputs = [...scope.querySelectorAll('input')].filter((el) => visible(el) && ['text', 'email', 'tel', ''].includes((el.getAttribute('type') || '').toLowerCase()))
  const byHint = inputs.find((el) => /username|email|login|user|nik|pesel/i.test([el.autocomplete, el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(' ')))
  const before = password ? inputs.filter((el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1) : undefined
  const user = byHint || before || (password ? undefined : inputs[0])
  if (password) password.setAttribute('data-mr-fill', 'p')
  if (user) user.setAttribute('data-mr-fill', 'u')
  return { username: Boolean(user), password: Boolean(password) }
})()`
