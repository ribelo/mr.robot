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
}

export interface BrowserDriver {
  open(state: BrowserState | null): Promise<BrowserPage>
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
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    if (state !== null) {
      if (state.cookies.length > 0) await page.setCookie(...(state.cookies as never[]))
      await page.evaluateOnNewDocument(`(() => {
        const saved = (${JSON.stringify(state.storage)})[location.origin]
        if (saved === undefined || sessionStorage.getItem('__mr_restored') === '1') return
        for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value)
        sessionStorage.setItem('__mr_restored', '1')
      })()`)
    }
    return new RenderingPage(browser, page, state?.storage ?? {})
  }
}

class RenderingPage implements BrowserPage {
  private cdpSession: CDPSession | undefined
  private readonly storage: Record<string, Readonly<Record<string, string>>>

  constructor(private readonly browser: Browser, private readonly page: Page, storage: Readonly<Record<string, Readonly<Record<string, string>>>>) {
    this.storage = { ...storage }
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await this.settle()
  }

  async observe(): Promise<Observation> {
    return (await this.page.evaluate(OBSERVE_SCRIPT)) as Observation
  }

  async act(action: BrowserAction): Promise<void> {
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
    await this.browser.close().catch(() => undefined)
  }

  /** Give the page a moment to react: a short network quiet period, bounded. */
  private async settle(): Promise<void> {
    await Promise.race([
      this.page.waitForNetworkIdle({ idleTime: 400, timeout: 4000 }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ])
  }
}
