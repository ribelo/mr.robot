/**
 * A full Turn through each real adapter and DSH's model resolution, with only the Provider's HTTP
 * answers faked. Adapter unit tests call stream() directly; this is the path a Robot takes.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const realFetch = globalThis.fetch
const sse = (data: unknown, event?: string) => `${event === undefined ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`
const stream = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } })

const answers: Record<string, () => Response> = {
  'https://openrouter.ai/api/v1/models': () => Response.json({ data: [{ id: 'z/model-a', name: 'Z: Model A', context_length: 100000, supported_parameters: ['tools'], pricing: { prompt: '0.000001', completion: '0.000002' } }] }),
  'https://opencode.ai/zen/go/v1/models': () => Response.json({ data: [{ id: 'minimax-m3' }, { id: 'gpt-5.6-luna' }] }),
  'https://models.dev/api.json': () => Response.json({ 'opencode-go': { models: {
    'minimax-m3': { name: 'MiniMax-M3', limit: { context: 1000000 }, provider: { npm: '@ai-sdk/anthropic' } },
    'gpt-5.6-luna': { name: 'GPT-5.6 Luna', limit: { context: 1050000 }, provider: { npm: '@ai-sdk/openai' } },
  } } }),
  'https://openrouter.ai/api/v1/chat/completions': () => stream(sse({ choices: [{ delta: { content: 'Hello from chat.' }, finish_reason: 'stop' }] }) + sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } }) + 'data: [DONE]\n\n'),
  'https://opencode.ai/zen/go/v1/messages': () => stream(
    sse({ type: 'message_start', message: { usage: { input_tokens: 10 } } }, 'message_start')
    + sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start')
    + sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from messages.' } }, 'content_block_delta')
    + sse({ type: 'content_block_stop', index: 0 }, 'content_block_stop')
    + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, 'message_delta')
    + sse({ type: 'message_stop' }, 'message_stop')),
  'https://opencode.ai/zen/go/v1/responses': () => stream(
    sse({ type: 'response.output_item.added', item: { type: 'message', id: 'm1' } })
    + sse({ type: 'response.output_text.delta', delta: 'Hello from responses.' })
    + sse({ type: 'response.output_item.done', item: { type: 'message', id: 'm1', content: [{ type: 'output_text', text: 'Hello from responses.' }] } })
    + sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 3 } } })),
}

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const answer = answers[url]
    return answer === undefined ? realFetch(input, init) : answer()
  }) as typeof fetch
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/providers/openrouter', { method: 'PUT', body: { key: 'sk-or-test', shared: false } })
  await api(ANNA, '/api/providers/opencode-go/keys', { body: { key: 'sk-opencode1234' } })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function turnOn(model: { provider: string; model: string }): Promise<Conversation> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await testRobot(body.id).activateForTest()
  const changed = await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, model: { ...model, effort: 'high' } } })
  expect(changed.status).toBe(200)
  await api(ANNA, `/api/robots/${body.id}/messages`, { body: { text: 'hi' } })
  await settle(body.id)
  return (await api<Conversation>(ANNA, `/api/robots/${body.id}/conversation`)).body
}

describe('a Turn through each real adapter', () => {
  it('chat completions (OpenRouter)', async () => {
    expect((await turnOn({ provider: 'openrouter', model: 'z/model-a' })).items.at(-1)).toMatchObject({ kind: 'reply', text: 'Hello from chat.' })
  })

  it('Anthropic Messages (OpenCode Go MiniMax)', async () => {
    expect((await turnOn({ provider: 'opencode-go', model: 'minimax-m3' })).items.at(-1)).toMatchObject({ kind: 'reply', text: 'Hello from messages.' })
  })

  it('Responses (OpenCode Go GPT-5.6 Luna)', async () => {
    expect((await turnOn({ provider: 'opencode-go', model: 'gpt-5.6-luna' })).items.at(-1)).toMatchObject({ kind: 'reply', text: 'Hello from responses.' })
  })
})
