import { describe, expect, it } from 'vitest'
import { liveModels } from '../src/providers/live-catalog.ts'

/** Response shapes as the live endpoints returned them on 2026-10-06 (trimmed). */
const responses: Record<string, unknown> = {
  'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0': { models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', context_window: 272000 },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', context_window: 272000 },
  ] },
  'https://api.anthropic.com/v1/models?limit=100': { data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', max_input_tokens: 1000000 }] },
  'https://opencode.ai/zen/go/v1/models': { object: 'list', data: [{ id: 'deepseek-v4-flash', object: 'model' }, { id: 'brand-new-model', object: 'model' }] },
  'https://openrouter.ai/api/v1/models': { data: [
    { id: 'google/gemini-nano-banana-2.1', name: 'Google: Nano Banana 2.1', context_length: 65536, supported_parameters: ['temperature'], pricing: { prompt: '0.0000015', completion: '0.0000075' } },
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', context_length: 1000000, supported_parameters: ['tools'], pricing: { prompt: '0.0000003', completion: '0.0000012' } },
  ] },
}
const fake = (async (input: RequestInfo | URL) => {
  const body = responses[String(input)]
  return body === undefined ? new Response('no', { status: 404 }) : Response.json(body)
}) as typeof fetch

describe('live model lists (robot-82r5)', () => {
  it('ChatGPT: only listed models, flat-rate', async () => {
    const models = await liveModels('openai', { oauth: { access: 't' }, fetch: fake })
    expect(models).toEqual([{ provider: 'openai', model: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', contextWindow: 272000, price: { input: 0, output: 0 } }])
  })

  it('Claude: what the subscription serves', async () => {
    expect((await liveModels('anthropic', { oauth: { access: 't' }, fetch: fake })).map((model) => [model.model, model.label, model.contextWindow])).toEqual([['claude-sonnet-5-5', 'Claude Sonnet 5.5', 1000000]])
  })

  it('OpenCode Go: ids from the plan, known ones enriched, new ones kept', async () => {
    const models = await liveModels('opencode-go', { key: 'k', fetch: fake })
    expect(models.map((model) => model.model)).toEqual(['deepseek-v4-flash', 'brand-new-model'])
    expect(models[0]!.label).toBe('DeepSeek V4 Flash')
    expect(models[1]).toMatchObject({ label: 'brand-new-model', contextWindow: 128000 })
  })

  it('OpenRouter: tool-capable models with per-million prices', async () => {
    expect(await liveModels('openrouter', { fetch: fake })).toEqual([{ provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', label: 'V4.1 Flash', contextWindow: 1000000, price: { input: 0.3, output: 1.2 } }])
  })

  it('fails without a credential instead of inventing a list', async () => {
    await expect(liveModels('deepseek', { fetch: fake })).rejects.toThrow('not connected')
  })
})
