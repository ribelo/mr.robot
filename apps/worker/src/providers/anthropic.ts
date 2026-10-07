/**
 * Anthropic Messages on a Claude subscription (robot-lzu3): OAuth bearer token, the Claude
 * Code system line the subscription requires, thinking budgets from the Robot's effort, and
 * thinking signatures replayed through DSH's replay state.
 */
import { LlmAdapter, LlmError, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { finishReason } from './openai-chat.ts'
import { httpFailure, imagesOf, loadImages, replayBlocks, sse, StreamWriter, systemText, textWithoutImages, type DshMessage, type ImageLoader, type LoadedImages } from './stream.ts'

const URL_ = 'https://api.anthropic.com/v1/messages?beta=true'
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const BUDGETS: Record<string, number> = { low: 2_048, medium: 6_000, high: 12_000, max: 24_000 }

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>; is_error?: boolean }

export function anthropicMessages(options: GenerateOptions, provider: string, images: LoadedImages = new Map()): Array<{ role: 'user' | 'assistant'; content: Block[] }> {
  const image = (part: { mediaType: string; base64: string }) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: part.mediaType, data: part.base64 } })
  const out: Array<{ role: 'user' | 'assistant'; content: Block[] }> = []
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    if (blocks.length === 0) return
    const last = out.at(-1)
    if (last?.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const message of options.messages) {
    if (message.role === 'user') {
      const text = textWithoutImages(message.content, images)
      const pictures = imagesOf(message.content, images).map(image)
      push('user', [...pictures, ...(text === '' && pictures.length > 0 ? [] : [{ type: 'text' as const, text: text || '.' }])])
    } else if (message.role === 'tool') {
      const text = textWithoutImages(message.content, images)
      const pictures = imagesOf(message.content, images).map(image)
      push('user', [{ type: 'tool_result', tool_use_id: toolId(message.toolCallId), content: pictures.length === 0 ? text : [{ type: 'text', text: text || 'image' }, ...pictures], ...(message.isError === true ? { is_error: true } : {}) }])
    }
    else if (message.role === 'assistant') push('assistant', assistantBlocks(message, provider))
  }
  return out
}

function assistantBlocks(message: DshMessage, provider: string): Block[] {
  const sameProvider = (message as { source?: { provider?: string } }).source?.provider === provider
  const replay = sameProvider ? replayBlocks(message) : []
  return message.content.flatMap((block, index): Block[] => {
    if (block.type === 'text') return block.text === '' ? [] : [{ type: 'text', text: block.text }]
    if (block.type === 'tool-call') return [{ type: 'tool_use', id: toolId(block.id), name: block.name, input: safeJson(block.arguments) }]
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

/** Where and how an Anthropic-Messages request goes. */
export interface AnthropicEndpoint {
  readonly url: string
  readonly headers: (options: GenerateOptions) => Promise<Record<string, string>>
  /** Claude subscriptions require the Claude Code identity line first in the system prompt. */
  readonly claudeCode: boolean
  readonly fetch?: typeof fetch
}

/** The Claude subscription endpoint (OAuth bearer token). */
export function claudeSubscription(token: () => Promise<string>): AnthropicEndpoint {
  return {
    url: URL_,
    claudeCode: true,
    headers: async () => ({
      authorization: `Bearer ${await token()}`,
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      'anthropic-dangerous-direct-browser-access': 'true',
      'user-agent': 'claude-cli/2.1.280 (external, cli)',
      'x-app': 'cli',
    }),
  }
}

export class AnthropicAdapter extends LlmAdapter {
  constructor(private readonly endpoint: AnthropicEndpoint, private readonly contextWindow: number, private readonly images?: ImageLoader) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      context: { contextWindow: this.contextWindow },
      defaultMaxTokens: 32_000,
      ...(this.images === undefined ? {} : { inputModalities: ['text', 'image'] }),
      reasoning: { efforts: ['off', 'low', 'medium', 'high', 'max'].map((id) => ({ id, name: id })) },
    } as never)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const effort = options.reasoningEffort === undefined ? 'off' : String(options.reasoningEffort)
    const budget = BUDGETS[effort]
    const maxTokens = Math.max(options.maxTokens ?? 16_000, (budget ?? 0) + 4_000)
    const system = systemText(options)
    const response = await (this.endpoint.fetch ?? fetch)(this.endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'anthropic-version': '2023-06-01',
        ...(await this.endpoint.headers(options)),
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: maxTokens,
        stream: true,
        system: [...(this.endpoint.claudeCode ? [{ type: 'text', text: IDENTITY }] : []), ...(system === '' ? [] : [{ type: 'text', text: system }])],
        messages: anthropicMessages(options, options.provider, await loadImages(options, this.images)),
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

/** Anthropic accepts [a-zA-Z0-9_-] ids; calls made earlier on another model may carry others (kimi: "functions.run_code:0"). */
function toolId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}
