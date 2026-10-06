/**
 * Names, context sizes, prices and (for OpenCode Go) the wire format of models, read live from
 * models.dev (the open catalog OpenCode uses). The Home fetches it daily and keeps only our
 * Providers' entries. It never decides which models are offered: that is each Provider's own list.
 */
import type { ModelOption } from '@mr-robot/protocol'

export type Wire = 'chat' | 'anthropic' | 'responses'

export interface ModelMeta {
  readonly name: string
  readonly contextWindow?: number
  readonly price?: ModelOption['price']
  readonly wire?: Wire
}

/** provider (ours) → model id → metadata */
export type MetadataIndex = Readonly<Record<string, Readonly<Record<string, ModelMeta>>>>

/** Our Provider ids → models.dev provider ids. OpenRouter's own list carries prices already. */
const SOURCES: Readonly<Record<string, string>> = {
  deepseek: 'deepseek',
  anthropic: 'anthropic',
  openai: 'openai',
  'opencode-go': 'opencode-go',
  'workers-ai': 'cloudflare-workers-ai',
}

const WIRES: Readonly<Record<string, Wire>> = { '@ai-sdk/openai': 'responses', '@ai-sdk/anthropic': 'anthropic' }

interface DevModel {
  readonly name?: string
  readonly limit?: { readonly context?: number }
  readonly cost?: { readonly input?: number; readonly output?: number; readonly cache_read?: number }
  readonly provider?: { readonly npm?: string }
}

export async function fetchMetadata(get: typeof fetch = fetch): Promise<MetadataIndex> {
  const response = await get('https://models.dev/api.json')
  if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
  const all = (await response.json()) as Record<string, { models?: Record<string, DevModel> }>
  return Object.fromEntries(Object.entries(SOURCES).map(([ours, theirs]) => [ours, Object.fromEntries(
    Object.entries(all[theirs]?.models ?? {}).map(([id, model]) => [id, {
      name: model.name ?? id,
      ...(model.limit?.context === undefined || model.limit.context <= 0 ? {} : { contextWindow: model.limit.context }),
      ...(model.cost?.input === undefined || model.cost.output === undefined ? {} : {
        price: { input: model.cost.input, output: model.cost.output, ...(model.cost.cache_read === undefined ? {} : { cachedInput: model.cost.cache_read }) },
      }),
      ...(ours === 'opencode-go' ? { wire: WIRES[model.provider?.npm ?? ''] ?? 'chat' } : {}),
    } satisfies ModelMeta]),
  )]))
}
