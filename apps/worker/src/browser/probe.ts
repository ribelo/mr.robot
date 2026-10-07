/**
 * The four-site evidence run (rb-690z): open a page on a backend and classify what came back.
 * Admin-only; the browser is closed afterwards.
 */
import type { BrowserBackend } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { BACKENDS, driverFor } from './backends.ts'

export interface ProbeResult {
  readonly backend: BrowserBackend
  readonly url: string
  readonly finalUrl: string
  readonly result: 'pass' | 'blocked' | 'challenged' | 'error'
  readonly title: string
  readonly text: string
  readonly challenge: string | null
  /** What the site sees as the visitor's address (from an IP echo, when asked). */
  readonly screenshot: string | null
  readonly error?: string
  readonly ms: number
}

export async function probe(env: Env, backend: BrowserBackend, url: string, vpnConfig: () => Promise<string | null>): Promise<ProbeResult> {
  const started = Date.now()
  const driver = driverFor(backend, env, { id: `probe-${crypto.randomUUID().slice(0, 8)}`, vpnConfig })
  let page: Awaited<ReturnType<typeof driver.open>> | undefined
  try {
    page = await driver.open(null)
    await page.goto(url)
    await page.waitFor({ ms: 2500 }).catch(() => undefined)
    const observation = await page.observe()
    const png = await page.screenshot().catch(() => undefined)
    let screenshot: string | null = null
    if (png !== undefined) {
      let binary = ''
      for (let index = 0; index < png.length; index += 0x8000) binary += String.fromCharCode(...png.subarray(index, index + 0x8000))
      screenshot = btoa(binary)
    }
    return {
      backend, url, finalUrl: observation.url,
      result: observation.blocked === true ? 'blocked' : observation.challenge !== null ? 'challenged' : 'pass',
      title: observation.title, text: observation.text.slice(0, 600), challenge: observation.challenge, screenshot, ms: Date.now() - started,
    }
  } catch (error) {
    return { backend, url, finalUrl: url, result: 'error', title: '', text: '', challenge: null, screenshot: null, error: `${BACKENDS[backend].label}: ${error instanceof Error ? error.message : String(error)}`, ms: Date.now() - started }
  } finally {
    await page?.close().catch(() => undefined)
  }
}
