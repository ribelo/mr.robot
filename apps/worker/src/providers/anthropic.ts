/**
 * Anthropic Messages on a Claude subscription (robot-lzu3): OAuth bearer token, the Claude
 * Code system line the subscription requires, thinking budgets from the Robot's effort, and
 * thinking signatures replayed through DSH's replay state.
 */
import { LlmAdapter, LlmError, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { finishReason } from './openai-chat.ts'
import { httpFailure, replayBlocks, sse, StreamWriter, systemText, textOf, type DshMessage } from './stream.ts'

const URL_ = 'https://api.anthropic.com/v1/messages?beta=true'
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const BUDGETS: Record<string, number> = { low: 2_048, medium: 6_000, high: 12_000, max: 24_000 }

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

function anthropicMessages(options: GenerateOptions, provider: string): Array<{ role: 'user' | 'assistant'; content: Block[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: Block[] }> = []
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (blocks.length === 0) return
    const last = out.at(-1)
    if (last?.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const message of options.messages) {
    if (message.role === 'user') push('user', [{ type: 'text', text: textOf(message.content) || '.' }])
    else if (message.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, content: textOf(message.content), ...(message.isError === true ? { is_error: true } : {}) }])
    else if (message.role === 'assistant') push('assistant', assistantBlocks(message, provider))
  }
  return out
}

function assistantBlocks(message: DshMessage, provider: string): Block[] {
  const sameProvider = (message as { source?: { provider?: string } }).source?.provider === provider
  const replay = sameProvider ? replayBlocks(message) : []
  return message.content.flatMap((block, index): Block[] => {
    if (block.type === 'text') return block.text === '' ? [] : [{ type: 'text', text: block.text }]
    if (block.type === 'tool-call') return [{ type: 'tool_use', id: block.id, name: block.name, input: safeJson(block.arguments) }]
    if (block.type === 'reasoning') {
      const signature = (replay[index] as { signature?: string } | null | undefined)?.signature
      return signature === undefined ? [] : [{ type: 'thinking', thinking: block.text, signature }]
    }
    return []
  })
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return {} }
}

export class AnthropicAdapter extends LlmAdapter {
  constructor(private readonly token: () => Promise<string>, private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      context: { contextWindow: this.contextWindow },
      defaultMaxTokens: 32_000,
      reasoning: { efforts: ['off', 'low', 'medium', 'high', 'max'].map((id) => ({ id, label: id })) },
    } as never)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const effort = options.reasoningEffort === undefined ? 'off' : String(options.reasoningEffort)
    const budget = BUDGETS[effort]
    const maxTokens = Math.max(options.maxTokens ?? 16_000, (budget ?? 0) + 4_000)
    const system = systemText(options)
    const response = await fetch(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${await this.token()}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
        'anthropic-dangerous-direct-browser-access': 'true',
        'user-agent': 'claude-cli/2.1.280 (external, cli)',
        'x-app': 'cli',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: maxTokens,
        stream: true,
        system: [{ type: 'text', text: IDENTITY }, ...(system === '' ? [] : [{ type: 'text', text: system }])],
        messages: anthropicMessages(options, options.provider),
        ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: options.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }),
        ...(budget === undefined ? {} : { thinking: { type: 'enabled', budget_tokens: budget } }),
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok || response.body === null) {
      await httpFailure('Anthropic', response)
      return
    }
    const writer = new StreamWriter()
    let signature = ''
    let stop: string | undefined
    let inputTokens = 0
    let cacheRead = 0
    for await (const event of sse(response.body)) {
      const data = JSON.parse(event.data) as Record<string, any>
      switch (data['type']) {
        case 'message_start':
          inputTokens = data['message']?.usage?.input_tokens ?? 0
          cacheRead = data['message']?.usage?.cache_read_input_tokens ?? 0
          break
        case 'content_block_start': {
          const block = data['content_block'] ?? {}
          signature = ''
          if (block.type === 'tool_use') yield* writer.toolStart(block.id, block.name)
          break
        }
        case 'content_block_delta': {
          const delta = data['delta'] ?? {}
          if (delta.type === 'text_delta') yield* writer.text_(delta.text)
          else if (delta.type === 'thinking_delta') yield* writer.reasoning(delta.thinking)
          else if (delta.type === 'signature_delta') signature += delta.signature
          else if (delta.type === 'input_json_delta') yield* writer.toolArgs(delta.partial_json)
          break
        }
        case 'content_block_stop':
          yield* writer.close(writer.openKind === 'reasoning' && signature !== '' ? { signature } : null)
          break
        case 'message_delta':
          stop = data['delta']?.stop_reason ?? stop
          yield { type: 'usage', usage: { inputTokens: inputTokens + cacheRead, outputTokens: data['usage']?.output_tokens ?? 0, cacheReadTokens: cacheRead } }
          break
        case 'error':
          throw new LlmError(`Anthropic: ${data['error']?.message ?? 'stream error'}`, data['error']?.type === 'overloaded_error' ? 'RATE_LIMIT' : 'PROVIDER_ERROR')
      }
    }
    yield* writer.close()
    yield { type: 'finish', reason: finishReason(stop, writer.sawToolCall), replayState: { response: null, blocks: writer.replay } }
  }
}
