/**
 * Each Provider's live model list (robot-82r5): what the Provider itself says it serves to this
 * credential. Shapes were read from the live endpoints on 2026-10-06:
 * - ChatGPT subscription: chatgpt.com/backend-api/codex/models, models with visibility "list"
 * - Claude subscription: api.anthropic.com/v1/models with the OAuth token
 * - DeepSeek: api.deepseek.com/models; OpenCode Go: opencode.ai/zen/go/v1/models (ids only)
 * - OpenRouter: openrouter.ai/api/v1/models (public; tool-capable models only)
 * - Workers AI: the AI binding's models() search, text generation with function calling
 * Missing context sizes and prices are filled from pi-ai's catalog (catalog.ts).
 */
import type { ModelOption } from '@mr-robot/protocol'
import { CATALOG } from './catalog.ts'

export interface ListingAccess {
  readonly key?: string
  readonly oauth?: { readonly access: string; readonly accountId?: string }
  readonly ai?: Ai
  readonly fetch?: typeof fetch
}

interface Listed {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly price?: ModelOption['price']
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return (await response.json()) as T
}

const perMillion = (perToken: string | undefined) => (perToken === undefined ? undefined : Math.round(Number(perToken) * 1e6 * 1e4) / 1e4)

async function listed(provider: string, access: ListingAccess): Promise<Listed[]> {
  const get = access.fetch ?? fetch
  switch (provider) {
    case 'openai': {
      if (access.oauth === undefined) throw new Error('not connected')
      const body = await json<{ models: Array<{ slug: string; display_name?: string; visibility?: string; context_window?: number }> }>(
        await get('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0', {
          headers: { authorization: `Bearer ${access.oauth.access}`, ...(access.oauth.accountId === undefined ? {} : { 'chatgpt-account-id': access.oauth.accountId }), originator: 'pi' },
        }), 'ChatGPT')
      return body.models.filter((model) => model.visibility === 'list').map((model) => ({
        id: model.slug, ...(model.display_name === undefined ? {} : { name: model.display_name }), ...(model.context_window === undefined ? {} : { contextWindow: model.context_window }), price: { input: 0, output: 0 },
      }))
    }
    case 'anthropic': {
      if (access.oauth === undefined) throw new Error('not connected')
      const body = await json<{ data: Array<{ id: string; display_name?: string; max_input_tokens?: number }> }>(
        await get('https://api.anthropic.com/v1/models?limit=100', {
          headers: { authorization: `Bearer ${access.oauth.access}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' },
        }), 'Anthropic')
      return body.data.map((model) => ({
        id: model.id, ...(model.display_name === undefined ? {} : { name: model.display_name }), ...(model.max_input_tokens === undefined ? {} : { contextWindow: model.max_input_tokens }), price: { input: 0, output: 0 },
      }))
    }
    case 'deepseek':
    case 'opencode-go': {
      if (access.key === undefined) throw new Error('not connected')
      const url = provider === 'deepseek' ? 'https://api.deepseek.com/models' : 'https://opencode.ai/zen/go/v1/models'
      const body = await json<{ data: Array<{ id: string }> }>(await get(url, { headers: { authorization: `Bearer ${access.key}` } }), provider === 'deepseek' ? 'DeepSeek' : 'OpenCode Go')
      return body.data.map((model) => ({ id: model.id }))
    }
    case 'openrouter': {
      const body = await json<{ data: Array<{ id: string; name?: string; context_length?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string; input_cache_read?: string } }> }>(
        await get('https://openrouter.ai/api/v1/models'), 'OpenRouter')
      return body.data.filter((model) => model.supported_parameters?.includes('tools') === true).map((model) => {
        const input = perMillion(model.pricing?.prompt)
        const output = perMillion(model.pricing?.completion)
        const cached = perMillion(model.pricing?.input_cache_read)
        return {
          id: model.id,
          ...(model.name === undefined ? {} : { name: model.name.replace(/^[^:]+: /, '') }),
          ...(model.context_length === undefined ? {} : { contextWindow: model.context_length }),
          ...(input === undefined || output === undefined ? {} : { price: { input, output, ...(cached === undefined ? {} : { cachedInput: cached }) } }),
        }
      })
    }
    case 'workers-ai': {
      if (access.ai === undefined) throw new Error('Workers AI is not bound in this deployment')
      const found: AiModelsSearchObject[] = []
      for (let page = 1; page <= 5; page += 1) {
        const batch = await access.ai.models({ task: 'Text Generation', per_page: 100, page, hide_experimental: true })
        found.push(...batch)
        if (batch.length < 100) break
      }
      return found
        .filter((model) => model.properties.some((property) => property.property_id === 'function_calling' && String(property.value) === 'true'))
        .map((model) => {
          const property = (id: string) => model.properties.find((entry) => entry.property_id === id)?.value
          const context = Number(property('context_window'))
          return { id: model.name, ...(Number.isFinite(context) && context > 0 ? { contextWindow: context } : {}), ...workersAiPrice(property('price')) }
        })
    }
    default:
      throw new Error(`no model list for ${provider}`)
  }
}

/** Workers AI prices come as [{ unit: "per M input tokens", price }, { unit: "per M output tokens", price }]. */
function workersAiPrice(value: unknown): { price?: ModelOption['price'] } {
  const entries = Array.isArray(value) ? value as Array<{ unit?: string; price?: number }> : []
  const input = entries.find((entry) => /input/i.test(entry.unit ?? ''))?.price
  const output = entries.find((entry) => /output/i.test(entry.unit ?? ''))?.price
  return input === undefined || output === undefined ? {} : { price: { input, output } }
}

const DEFAULT_CONTEXT = 128_000

/** The Provider's live list, with names, context sizes and prices filled from pi-ai where missing. */
export async function liveModels(provider: string, access: ListingAccess): Promise<ModelOption[]> {
  const known = new Map(CATALOG.filter((model) => model.provider === provider).map((model) => [model.model, model]))
  const models = await listed(provider, access)
  if (models.length === 0) throw new Error(`${provider} listed no usable models`)
  return models.map((model) => {
    const fallback = known.get(model.id)
    return {
      provider,
      model: model.id,
      label: model.name ?? fallback?.label ?? model.id,
      contextWindow: model.contextWindow ?? fallback?.contextWindow ?? DEFAULT_CONTEXT,
      price: model.price ?? fallback?.price ?? { input: 0, output: 0 },
    }
  })
}
