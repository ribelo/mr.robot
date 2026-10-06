import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { AnthropicAdapter, claudeSubscription } from '../src/providers/anthropic.ts'
import { chatgptSubscription, CodexAdapter } from '../src/providers/codex.ts'
import { ChatCompletionsAdapter } from '../src/providers/openai-chat.ts'
import { opencodeGoAdapter } from '../src/providers/opencode-go.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function serve(events: string[]): { requests: Array<{ url: string; body: any; headers: Headers }> } {
  const requests: Array<{ url: string; body: any; headers: Headers }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
    return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  return { requests }
}

const sse = (data: unknown, event?: string) => `${event === undefined ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const base = (provider: string): GenerateOptions => ({
  provider,
  model: 'm',
  messages: [
    { id: 's', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Be a Robot.' }] } as never,
    createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }),
  ],
  tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
})

describe('Provider adapters', () => {
  it('OpenRouter: streams text and tool calls in chat-completions format', async () => {
    const { requests } = serve([
      sse({ choices: [{ delta: { content: 'Look' } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{"pa' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] }, finish_reason: 'tool_calls' }] }),
      sse({ usage: { prompt_tokens: 12, completion_tokens: 3 } }),
      'data: [DONE]\n\n',
    ])
    const adapter = new ChatCompletionsAdapter({ name: 'OpenRouter', url: 'https://openrouter.test', contextWindow: 1000, headers: async () => ({ authorization: 'Bearer k' }) })
    const chunks = await collect(adapter.stream(base('openrouter')))
    expect(requests[0]!.body.messages[0]).toEqual({ role: 'system', content: 'Be a Robot.' })
    expect(requests[0]!.body.tools[0].function.name).toBe('read')
    const ends = chunks.filter((chunk) => chunk.type === 'block-end').map((chunk) => (chunk as { block: unknown }).block)
    expect(ends).toEqual([{ type: 'text', text: 'Look' }, { type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"x"}' }])
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 0 } })
  })

  it('Anthropic: Claude Code system line, thinking with signature kept for replay', async () => {
    const { requests } = serve([
      sse({ type: 'message_start', message: { usage: { input_tokens: 20 } } }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-1' } }),
      sse({ type: 'content_block_stop', index: 0 }),
      sse({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
      sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } }),
      sse({ type: 'content_block_stop', index: 1 }),
      sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }),
      sse({ type: 'message_stop' }),
    ])
    const adapter = new AnthropicAdapter(claudeSubscription(async () => 'oauth-token'), 200_000)
    const chunks = await collect(adapter.stream({ ...base('anthropic'), reasoningEffort: 'high' as never }))
    const request = requests[0]!
    expect(request.headers.get('authorization')).toBe('Bearer oauth-token')
    expect(request.body.system[0].text).toBe("You are Claude Code, Anthropic's official CLI for Claude.")
    expect(request.body.system[1].text).toBe('Be a Robot.')
    expect(request.body.thinking).toEqual({ type: 'enabled', budget_tokens: 12_000 })
    const finish = chunks.at(-1) as unknown as { replayState: { response: null; blocks: readonly unknown[] } }
    expect(finish.replayState.blocks).toEqual([{ signature: 'sig-1' }, null])

    const second = serve([sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })])
    await collect(adapter.stream({
      ...base('anthropic'),
      messages: [
        ...base('anthropic').messages,
        { id: 'a', role: 'assistant', source: { kind: 'model', provider: 'anthropic', model: 'm', replayState: finish.replayState }, content: [{ type: 'reasoning', text: 'hmm' }, { type: 'tool-call', id: 't1', name: 'read', arguments: '{}' }] } as never,
        { id: 't', role: 'tool', toolCallId: 't1', source: { kind: 'tool', callId: 't1' }, content: [{ type: 'text', text: 'file' }] } as never,
      ],
    }))
    expect(second.requests[0]!.body.messages.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm', signature: 'sig-1' }, { type: 'tool_use', id: 't1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file' }] },
    ])
  })

  it('Codex: Responses input items and encrypted reasoning for replay', async () => {
    const { requests } = serve([
      sse({ type: 'response.output_item.added', item: { type: 'reasoning' } }),
      sse({ type: 'response.reasoning_summary_text.delta', delta: 'thinking' }),
      sse({ type: 'response.output_item.done', item: { type: 'reasoning', encrypted_content: 'enc-1' } }),
      sse({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'call-1', name: 'read' } }),
      sse({ type: 'response.function_call_arguments.delta', delta: '{"path":"a"}' }),
      sse({ type: 'response.output_item.done', item: { type: 'function_call' } }),
      sse({ type: 'response.completed', response: { usage: { input_tokens: 30, output_tokens: 4 } } }),
    ])
    const adapter = new CodexAdapter(chatgptSubscription(async () => ({ access: 'tok', accountId: 'acct' })), 272_000)
    const chunks = await collect(adapter.stream(base('openai')))
    const request = requests[0]!
    expect(request.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(request.headers.get('chatgpt-account-id')).toBe('acct')
    expect(request.body.instructions).toBe('Be a Robot.')
    expect(request.body.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
    expect(request.body.store).toBe(false)
    const finish = chunks.at(-1) as unknown as { reason: unknown; replayState: { blocks: readonly unknown[] } }
    expect(finish.reason).toEqual({ kind: 'tool-calls' })
    expect(finish.replayState.blocks).toEqual([{ encrypted: 'enc-1' }, null])
  })

  it('OpenCode Go: each model on its wire format, with the session header and a pool key (ticket 19)', async () => {
    const pool = {
      candidates: async () => ({ keys: [{ id: 'a', key: 'sk-pool' }], activeId: 'a' }),
      promote: async () => undefined,
      stick: async () => undefined,
    }
    const seen: Array<{ url: string; auth: string | null; apiKey: string | null; session: string | null; system: unknown }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const body = (await request.json()) as { system?: unknown }
      seen.push({ url: request.url, auth: request.headers.get('authorization'), apiKey: request.headers.get('x-api-key'), session: request.headers.get('x-opencode-session'), system: body.system })
      return new Response('', { status: 500 })
    }) as typeof fetch
    for (const model of ['deepseek-v4-flash', 'minimax-m3', 'gpt-5.6-luna']) {
      await collect(opencodeGoAdapter(model, pool).stream({ ...base('opencode-go'), model, sessionId: 'sess-1' } as never)).catch(() => undefined)
    }
    expect(seen.map((entry) => entry.url)).toEqual([
      'https://opencode.ai/zen/go/v1/chat/completions',
      'https://opencode.ai/zen/go/v1/messages',
      'https://opencode.ai/zen/go/v1/responses',
    ])
    expect(seen.map((entry) => entry.session)).toEqual(['sess-1', 'sess-1', 'sess-1'])
    expect([seen[0]!.auth, seen[1]!.apiKey, seen[2]!.auth]).toEqual(['Bearer sk-pool', 'sk-pool', 'Bearer sk-pool'])
    expect(JSON.stringify(seen[1]!.system)).not.toContain('Claude Code')
  })
})
