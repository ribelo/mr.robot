/**
 * Web fetch and search through the DSH web seam (robot-o6lf): dsh-web holds the providers,
 * dsh-tool-web turns them into the model's web_fetch and web_search tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import WebRuntime, { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
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

export function webPlugin(credentials: CredentialSource): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(WebRuntime)
    ctx.web.registerFetchProvider(new WorkerFetchProvider())
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
