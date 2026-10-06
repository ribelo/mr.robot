/**
 * The models every Provider offers, from pi-ai's generated catalog (@earendil-works/pi-ai, the
 * catalog DSH's llm-pi-ai uses). Only the per-Provider data files are imported: plain JSON, no SDKs.
 * Nothing here is typed in by hand; upgrading pi-ai updates the offer, names, context sizes and prices.
 */
import type { ModelOption } from '@mr-robot/protocol'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { CLOUDFLARE_WORKERS_AI_MODELS } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai.models'
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models'
import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models'
import { OPENCODE_GO_MODELS as PI_OPENCODE_GO } from '@earendil-works/pi-ai/providers/opencode-go.models'
import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models'

interface PiModel {
  readonly id: string
  readonly name: string
  readonly api: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead?: number }
}

const list = (catalog: unknown): PiModel[] => Object.values(catalog as Record<string, PiModel>)

/** Our Provider id → pi-ai's catalog. Subscriptions are flat-rate, so their tokens cost 0 here. */
const SOURCES: ReadonlyArray<{ provider: string; models: PiModel[]; subscription: boolean }> = [
  { provider: 'deepseek', models: list(DEEPSEEK_MODELS), subscription: false },
  { provider: 'opencode-go', models: list(PI_OPENCODE_GO), subscription: false },
  { provider: 'anthropic', models: list(ANTHROPIC_MODELS), subscription: true },
  { provider: 'openai', models: list(OPENAI_CODEX_MODELS), subscription: true },
  { provider: 'workers-ai', models: list(CLOUDFLARE_WORKERS_AI_MODELS), subscription: false },
  { provider: 'openrouter', models: list(OPENROUTER_MODELS), subscription: false },
]

/** Newest first: compare the version numbers in the id ("opus-5-5" before "sonnet-4-5"), then the name. */
function newestFirst(a: PiModel, b: PiModel): number {
  const version = (id: string) => (id.split('/').at(-1) ?? id).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []
  const [x, y] = [version(a.id), version(b.id)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d !== 0) return d
  }
  return a.name.localeCompare(b.name)
}

/** Dated aliases ("claude-opus-4-5-20251101") duplicate their undated model; keep one of each. */
const isDatedAlias = (id: string) => /-\d{8}$/.test(id)

export const CATALOG: readonly ModelOption[] = SOURCES.flatMap(({ provider, models, subscription }) =>
  models
    .filter((model) => !isDatedAlias(model.id))
    .sort(newestFirst)
    .map((model) => ({
      provider,
      model: model.id,
      label: model.name.replace(/ \(latest\)$/, ''),
      contextWindow: model.contextWindow,
      price: subscription
        ? { input: 0, output: 0 }
        : { input: model.cost.input, output: model.cost.output, ...(model.cost.cacheRead === undefined ? {} : { cachedInput: model.cost.cacheRead }) },
    })),
)

export type OpencodeWire = 'chat' | 'anthropic' | 'responses'

const WIRES: Record<string, OpencodeWire> = { 'openai-completions': 'chat', 'anthropic-messages': 'anthropic', 'openai-responses': 'responses' }

/** OpenCode Go models with the wire format each speaks at opencode.ai/zen/go. */
export const OPENCODE_GO_MODELS = list(PI_OPENCODE_GO).flatMap((model) => {
  const wire = WIRES[model.api]
  return wire === undefined ? [] : [{ id: model.id, name: model.name, wire, contextWindow: model.contextWindow, maxTokens: model.maxTokens }]
})
