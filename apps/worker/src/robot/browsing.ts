/**
 * The Robot's browser tools as Effect programs (ticket 23): the page comes from the platform
 * (Browser Rendering over CDP is the boundary), rules such as the payment stop live here.
 */
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import type { BrowserAction, BrowserPage } from '../browser/driver.ts'
import type { Observation } from '../browser/observe.ts'
import type { ScreenshotImage } from '../agent/tools/browser.ts'
import { invalid } from '../platform/durable.ts'

export interface BrowsingShape {
  /** The Robot's one browser session (reattached, reopened or new). */
  page(): Effect.Effect<BrowserPage>
  /** An observation with granted secrets masked. */
  observed(page: BrowserPage): Effect.Effect<Observation>
  /** Save a screenshot in the Workspace as the Robot's screen. */
  saveScreen(png: Uint8Array): Effect.Effect<{ path: string }>
  /** Sites that blocked this browser backend during the current Turn (rb-kank). */
  readonly blockedThisTurn: Set<string>
}

export class Browsing extends Context.Service<Browsing, BrowsingShape>()('mr-robot/Browsing') {}

/** Labels of the final payment or order step, in English and Polish. */
const PAYMENT_STEP = /\b(pay( now)?|place (your )?order|buy now|complete (purchase|order)|confirm (and pay|payment|purchase)|submit order)\b|zapłać|płacę|kupuję|kupuj i płać|zamawiam|złóż zamówienie|potwierdzam (zakup|płatność)|przejdź do płatności/i
/** A checkout or payment page, by address or title. */
const CHECKOUT_PAGE = /checkout|payment|kasa|platnosc|płatność|zamowienie|zamówienie/i
/** The closing button on such a page. */
const CHECKOUT_FINAL = /^\s*(finish|confirm|complete|submit|zakończ|potwierdź|zatwierdź)\b/i

/** A page call that fails becomes a tool error the model reads. */
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => invalid(error instanceof Error ? error.message : String(error)) })

export const open = (url: string) => Effect.gen(function* () {
  if (!/^https?:\/\//.test(url)) return yield* invalid('only http and https URLs')
  const browsing = yield* Browsing
  const page = yield* browsing.page()
  const host = new URL(url).hostname
  const before = [...browsing.blockedThisTurn].find((key) => key.endsWith(`|${host}`))
  // A block page is reported, not retried: no loop of reopening a site that refuses this browser.
  if (before !== undefined) return yield* invalid(`${host} already blocked the ${before.split('|')[0]} browser in this Turn. Do not retry: tell your owner and suggest another browser backend in this Robot's Advanced settings.`)
  yield* attempt(() => page.goto(url))
  const observation = yield* browsing.observed(page)
  if (observation.blocked === true) browsing.blockedThisTurn.add(`${observation.backend ?? 'browser'}|${host}`)
  return observation
})

export const observe = Effect.gen(function* () {
  const browsing = yield* Browsing
  return yield* browsing.observed(yield* browsing.page())
})

export const act = (action: BrowserAction) => Effect.gen(function* () {
  const browsing = yield* Browsing
  const page = yield* browsing.page()
  if (action.action === 'click' || (action.action === 'type' && action.submit === true)) {
    // Payment stays with the owner (robot-ueh0): the final pay/order step is never clicked by a Robot.
    const observation = yield* attempt(() => page.observe())
    const target = observation.elements.find((element) => element.index === action.index)
    // On a checkout page the last button is often just "Finish" or "Confirm" (saucedemo.com, many shops).
    const checkout = CHECKOUT_PAGE.test(`${observation.url} ${observation.title}`) && CHECKOUT_FINAL.test(target?.label ?? '')
    if (target !== undefined && (PAYMENT_STEP.test(target.label) || checkout)) {
      return yield* invalid(`"${target.label}" looks like the payment or final order step. Stop here: tell your owner what is ready, or call browser_request_takeover so they pay themselves.`)
    }
  }
  yield* attempt(() => page.act(action))
  return yield* browsing.observed(page)
})

export const wait = (input: { text?: string; ms?: number }) => Effect.gen(function* () {
  const browsing = yield* Browsing
  const page = yield* browsing.page()
  yield* attempt(() => page.waitFor(input))
  return yield* browsing.observed(page)
})

/** A screenshot the model sees as an image (robot-cmz9) and the owner sees as the screen. */
export const screenshot = Effect.gen(function* () {
  const browsing = yield* Browsing
  const page = yield* browsing.page()
  const png = yield* attempt(() => page.screenshot())
  const { path } = yield* browsing.saveScreen(png)
  const name = path.slice('screens/'.length)
  // PNG: width and height are the first two fields of the IHDR chunk.
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const image: ScreenshotImage = { attachmentId: `screen:${name}`, mediaType: 'image/png', bytes: png.byteLength, width: view.getUint32(16), height: view.getUint32(20), name }
  return { path, image }
})
