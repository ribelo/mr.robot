/**
 * Web fetch and search through the DSH web seam (robot-o6lf): dsh-web holds the providers,
 * dsh-tool-web turns them into the model's web_fetch and web_search tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import puppeteer from '@cloudflare/puppeteer'
import WebRuntime, { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { DeepSeekSearchProvider, DEEPSEEK_DEFAULT_API_VERSION, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_DEFAULT_MAX_TOKENS, DEEPSEEK_DEFAULT_MAX_USES, DEEPSEEK_DEFAULT_MODEL } from '@deepseek-ai/dsh-web-search-deepseek'
import type { CredentialSource } from './providers.ts'

const MAX_BODY_BYTES = 2_000_000

/** Plain fetch from the Worker: public http(s) only, bounded size, HTML or text. */
class WorkerFetchProvider implements WebFetchProvider {
  readonly id = 'worker-fetch'

  available(): boolean {
    return true
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const url = new URL(request.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WebError(`only http and https URLs can be fetched`, 'INVALID_URL')
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; MrRobot/1.0)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      ...(signal === undefined ? {} : { signal }),
    })
    const type = response.headers.get('content-type') ?? ''
    if (!/text\/|json|xml/.test(type)) {
      await response.body?.cancel()
      throw new WebError(`unsupported content type ${type || 'unknown'}; use the browser for this page`, 'UNSUPPORTED_CONTENT_TYPE')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const truncated = bytes.length > MAX_BODY_BYTES
    const content = new TextDecoder().decode(truncated ? bytes.slice(0, MAX_BODY_BYTES) : bytes)
    return {
      url: response.url || request.url,
      statusCode: response.status,
      truncated,
      body: type.includes('html') ? { kind: 'html', content } : { kind: 'text', content },
    }
  }
}

/**
 * Search without a search key (robot-o6lf): Bing's results page in Browser Rendering. A real
 * browser is needed; DuckDuckGo, Google and Brave answer a Cloudflare browser with a bot check,
 * Bing with results (checked 2026-10-07).
 */
export class BrowserSearchProvider implements WebSearchProvider {
  readonly id = 'browser-bing'

  constructor(private readonly browser: Fetcher) {}

  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest): Promise<WebSearchResult> {
    const max = Math.min(request.maxResults ?? 8, 20)
    const browser = await puppeteer.launch(this.browser as never)
    try {
      const page = await browser.newPage()
      await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(request.query)}&setlang=en&count=${max}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      const found = await page.evaluate(`[...document.querySelectorAll('li.b_algo')].map((item) => ({
        title: item.querySelector('h2')?.innerText ?? '',
        href: item.querySelector('h2 a')?.href ?? '',
        snippet: (item.querySelector('.b_caption p, p')?.innerText ?? '').trim(),
      }))`) as Array<{ title: string; href: string; snippet: string }>
      const sources = found.map((result) => ({ url: bingTarget(result.href), title: result.title, ...(result.snippet === '' ? {} : { snippet: result.snippet }) }))
        .filter((source) => /^https?:\/\//.test(source.url)).slice(0, max)
      if (sources.length === 0) throw new WebError('the search returned no results; try other words, or use the browser', 'SEARCH_FAILED' as never)
      return { sources, truncated: false }
    } finally {
      await browser.close().catch(() => undefined)
    }
  }
}

/** Bing wraps results in bing.com/ck/a?…&u=a1<base64url of the target>; unwrap to the real address. */
export function bingTarget(href: string): string {
  try {
    const url = new URL(href)
    const wrapped = url.hostname.endsWith('bing.com') ? url.searchParams.get('u') : null
    if (wrapped === null || !wrapped.startsWith('a1')) return href
    const base64 = wrapped.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  } catch {
    return href
  }
}

export function webPlugin(credentials: CredentialSource, browser?: Fetcher): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(WebRuntime)
    ctx.web.registerFetchProvider(new WorkerFetchProvider())
    // DeepSeek's search when the owner can use a DeepSeek key, otherwise Bing in Browser Rendering.
    const deepseek = await credentials.resolve('deepseek').catch(() => undefined)
    if (deepseek?.kind !== 'api-key' && browser !== undefined) {
      ctx.web.registerSearchProvider(new BrowserSearchProvider(browser))
      await ctx.plugin(ToolWeb, {})
      return
    }
    ctx.web.registerSearchProvider(new DeepSeekSearchProvider(() => ({
      resolveApiKey: async () => {
        const credential = await credentials.resolve('deepseek')
        return credential?.kind === 'api-key' ? credential.key : undefined
      },
      baseURL: DEEPSEEK_DEFAULT_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL,
      apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      maxUses: DEEPSEEK_DEFAULT_MAX_USES,
    }) as never))
    await ctx.plugin(ToolWeb, {})
  }
}
