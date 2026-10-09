/**
 * Web fetch through the DSH web seam (robot-o6lf): dsh-web holds the fetch provider, dsh-tool-web
 * turns it into the model's web_fetch tool. The generic web_search tool and its search providers are
 * not mounted (v1.8, ts-6b3k): it answered mostly to the first word of the query; search is Exa's.
 */
import type { Context } from '@deepseek-ai/cordis'
import WebRuntime, { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { withToolRewrite } from './tool-wording.ts'

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

const FETCH_DESCRIPTION = 'Fetch the content of a specific HTTP(S) URL and return it decoded to text. A page that answers with an error (404, 500) does not throw: the result carries its statusCode, so check it. This does not search; to search the web use web_search_exa.'

/** dsh-tool-web with fetch only, and a web_fetch description that states the status behaviour and where search is. */
const FetchOnly = {
  ...ToolWeb,
  apply: (ctx: Context, config: unknown) => ToolWeb.apply(withToolRewrite(ctx, (tool) => (tool.name === 'web_fetch' ? { ...tool, description: FETCH_DESCRIPTION } : tool)) as never, config as never),
}

/** The web seam with the Worker's fetch provider, and dsh-tool-web with web_fetch only. */
export async function webPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(WebRuntime)
  ctx.web.registerFetchProvider(new WorkerFetchProvider())
  await ctx.plugin(FetchOnly as never, { search: false } as never)
}
