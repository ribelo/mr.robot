/**
 * A stub browser for Robot DO tests: one fixture shop with a login form. Cookies live in the
 * browser session, so only the Robot's saved state can carry a login into a new session.
 */
import type { BrowserAction, BrowserDriver, BrowserPage, BrowserState } from '../src/browser/driver.ts'
import { StaleRef } from '../src/browser/driver.ts'
import type { Observation } from '../src/browser/observe.ts'

export const browserLog: string[] = []

export class StubDriver implements BrowserDriver {
  async open(state: BrowserState | null): Promise<BrowserPage> {
    browserLog.push('open')
    return new StubPage(state)
  }
}

class StubPage implements BrowserPage {
  private current = 'about:blank'
  private cookies: Array<Record<string, unknown>>
  private typed = ''
  private shots = 0

  constructor(state: BrowserState | null) {
    this.cookies = [...(state?.cookies ?? [])]
  }

  private get loggedIn(): boolean {
    return this.cookies.some((cookie) => cookie['name'] === 'session' && cookie['value'] === 'ok')
  }

  async goto(url: string): Promise<void> {
    this.current = url
  }

  async observe(): Promise<Observation> {
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

  async waitFor(): Promise<void> {}

  async screenshot(): Promise<Uint8Array> {
    this.shots += 1
    return new Uint8Array([137, 80, 78, 71, this.shots])
  }

  url(): string {
    return this.current
  }

  async exportState(): Promise<BrowserState> {
    return { cookies: this.cookies, storage: {} }
  }

  async cdp(): Promise<undefined> {
    return undefined
  }

  async close(): Promise<void> {
    browserLog.push('close')
  }
}
