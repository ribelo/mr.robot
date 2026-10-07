/**
 * Staging Worker for the Browser Rendering integration test: runs the production driver on
 * Cloudflare against a fixture page and reports what it saw. Deployed and deleted by
 * scripts/browser-staging.ts.
 */
import { RenderingDriver } from '../../src/browser/driver.ts'
import { BrowserSearchProvider } from '../../src/agent/web.ts'

const FIXTURE = `<!doctype html><title>Fixture shop</title>
<h1>Fixture shop</h1>
<label>Customer name <input name="customer"></label>
<label><input type="checkbox" name="gift"> Gift wrap</label>
<button onclick="document.cookie='session=ok; path=/; max-age=3600'; document.querySelector('h1').textContent='Signed in'">Sign in</button>`

export default {
  async fetch(request: Request, env: { BROWSER: Fetcher }): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/fixture') return new Response(FIXTURE, { headers: { 'content-type': 'text/html' } })
    if (url.pathname === '/cookie') return new Response(`<!doctype html><title>Cookie</title><p>${request.headers.get('cookie') ?? 'none'}</p>`, { headers: { 'content-type': 'text/html' } })
    if (url.pathname === '/notify') return new Response('<!doctype html><title>Notifier</title><p>Waiting</p><script>setTimeout(() => { Notification.requestPermission().then(() => new Notification("Order 1042", { body: "Out for delivery" })) }, 1500)</script>', { headers: { 'content-type': 'text/html' } })
    if (url.pathname !== '/run') return new Response('not found', { status: 404 })
    const report: Record<string, unknown> = {}
    const driver = new RenderingDriver(env.BROWSER)
    const page = await driver.open(null)
    try {
      await page.goto(`${url.origin}/fixture`)
      const first = await page.observe()
      report.title = first.title
      const name = first.elements.find((element) => element.label.includes('Customer name'))
      const gift = first.elements.find((element) => element.role === 'checkbox')
      const signIn = first.elements.find((element) => element.label === 'Sign in')
      await page.act({ action: 'type', index: name!.index, text: 'Mr. Robot' })
      await page.act({ action: 'check', index: gift!.index, checked: true })
      await page.act({ action: 'click', index: signIn!.index })
      const after = await page.observe()
      report.typed = after.elements.find((element) => element.index === name!.index)?.value
      report.checked = after.elements.find((element) => element.index === gift!.index)?.checked
      report.heading = after.text.split('\n')[0]
      const png = await page.screenshot()
      report.screenshotBytes = png.length
      report.png = [...png.slice(0, 4)]
      const state = await page.exportState()
      await page.close()
      const second = await driver.open(state)
      await second.goto(`${url.origin}/cookie`)
      report.cookieInNewSession = (await second.observe()).text
      // Live view (ticket 09): a CDP screencast delivers frames; a CDP tap reaches the page.
      const cdp = (await second.cdp())!
      let frames = 0
      cdp.on('Page.screencastFrame', ((frame: { sessionId: number }) => {
        frames += 1
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      }) as never)
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 })
      await second.goto(`${url.origin}/fixture`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await cdp.send('Page.stopScreencast')
      report.screencastFrames = frames
      // Takeover input (ticket 09): a tap on the name field, typed text, then a tap on Sign in.
      const box = async (selector: string) => {
        const { result } = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`, returnByValue: true }) as { result: { value: string } }
        const rect = JSON.parse(result.value) as { x: number; y: number; width: number; height: number }
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }
      const tap = async (point: { x: number; y: number }) => {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      }
      await tap(await box('input[name=customer]'))
      await cdp.send('Input.insertText', { text: 'Typed by a person' })
      await tap(await box('button'))
      await new Promise((resolve) => setTimeout(resolve, 500))
      const taken = await second.observe()
      report.takeoverTyped = taken.elements.find((element) => element.label.includes('Customer name'))?.value
      report.takeoverClicked = taken.text.split('\n')[0]
      await second.close()
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error)
      await page.close()
    }
    try {
      // A real site's own bot check is recognised (robot-b49q).
      const checked = await driver.open(null)
      await checked.goto('https://html.duckduckgo.com/html/?q=mokotow')
      report.botCheck = (await checked.observe()).challenge
      await checked.close()
    } catch (error) {
      report.botCheckError = error instanceof Error ? error.message : String(error)
    }
    try {
      // Wake on screen notifications: leave a page running, reconnect, read what it showed.
      const watched = await driver.open(null)
      await watched.goto(`${url.origin}/notify`)
      // A check before the page notifies must not lose later notifications (bug found live 2026-10-07).
      report.watchEarly = await watched.takeNotifications()
      const sessionId = watched.sessionId()
      await watched.detach()
      await new Promise((resolve) => setTimeout(resolve, 4000))
      const again = await driver.attach(sessionId)
      report.watchReattached = again !== undefined
      report.watchNotifications = again === undefined ? [] : await again.takeNotifications()
      await again?.close()
    } catch (error) {
      report.watchError = error instanceof Error ? error.message : String(error)
    }
    try {
      const found = await new BrowserSearchProvider(env.BROWSER).search({ query: 'otodom mokotow 2 pokoje' })
      report.searchCount = found.sources.length
      report.searchFirst = found.sources[0]?.url
    } catch (error) {
      report.searchError = error instanceof Error ? error.message : String(error)
    }
    return Response.json(report)
  },
}
