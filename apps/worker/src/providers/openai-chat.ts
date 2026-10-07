/**
 * OpenAI chat-completions wire format: OpenRouter (robot-7v9s) streams it; Workers AI returns
 * it from its binding in one piece.
 */
import { LlmAdapter, LlmError, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { httpFailure, sse, StreamWriter, systemText, textOf } from './stream.ts'

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Chat-completions history. An assistant turn with only tool calls carries content null, as
 * OpenAI documents; Workers AI's schema refuses null there and needs '' (gpt-oss-120b, 2026-10-07).
 */
export function chatMessages(options: GenerateOptions, emptyAssistant: '' | null = null): ChatMessage[] {
  const out: ChatMessage[] = []
  const system = systemText(options)
  if (system !== '') out.push({ role: 'system', content: system })
  for (const message of options.messages) {
    switch (message.role) {
      case 'user':
        out.push({ role: 'user', content: textOf(message.content) })
        break
      case 'assistant': {
        const calls = message.content.flatMap((block) => block.type === 'tool-call' ? [{ id: block.id, type: 'function' as const, function: { name: block.name, arguments: block.arguments } }] : [])
        const text = textOf(message.content)
        // DeepSeek-style thinking models require their reasoning back on tool turns.
        const reasoning = message.content.flatMap((block) => (block.type === 'reasoning' ? [block.text] : [])).join('')
        out.push({
          role: 'assistant',
          content: text === '' ? emptyAssistant : text,
          ...(reasoning === '' ? {} : { reasoning_content: reasoning }),
          ...(calls.length === 0 ? {} : { tool_calls: calls }),
        })
        break
      }
      case 'tool':
        out.push({ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content) })
        break
      default:
        break
    }
  }
  return out
}

export function chatTools(options: GenerateOptions) {
  return (options.tools ?? []).map((tool) => ({ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
}

const EFFORTS = [{ id: 'off', name: 'off' }, { id: 'low', name: 'low' }, { id: 'medium', name: 'medium' }, { id: 'high', name: 'high' }]

export interface ChatAdapterOptions {
  readonly name: string
  readonly url: string
  readonly headers: (options: GenerateOptions) => Promise<Record<string, string>>
  readonly contextWindow: number
  readonly fetch?: typeof fetch
}

/** Streaming chat completions over HTTP (OpenRouter). */
export class ChatCompletionsAdapter extends LlmAdapter {
  constructor(private readonly options: ChatAdapterOptions) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.options.contextWindow }, defaultMaxTokens: 16_000, reasoning: { efforts: EFFORTS } } as never)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const effort = options.reasoningEffort === undefined || String(options.reasoningEffort) === 'off' ? undefined : String(options.reasoningEffort)
    const response = await (this.options.fetch ?? fetch)(this.options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await this.options.headers(options)) },
      body: JSON.stringify({
        model: options.model,
        messages: chatMessages(options),
        ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: chatTools(options), tool_choice: 'auto' }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        ...(effort === undefined ? {} : { reasoning: { effort } }),
        stream: true,
        stream_options: { include_usage: true },
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok || response.body === null) {
      await httpFailure(this.options.name, response)
      return
    }
    const writer = new StreamWriter()
    const calls = new Map<number, string>()
    let finish: string | undefined
    for await (const event of sse(response.body)) {
      if (event.data === '[DONE]') break
      const chunk = JSON.parse(event.data) as {
        choices?: Array<{ delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>
        usage?: null | { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
        error?: { message?: string }
      }
      if (chunk.error !== undefined) throw new LlmError(`${this.options.name}: ${chunk.error.message ?? 'error'}`, 'PROVIDER_ERROR')
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      const reasoning = delta?.reasoning ?? delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning !== '') yield* writer.reasoning(reasoning)
      if (typeof delta?.content === 'string' && delta.content !== '') yield* writer.text_(delta.content)
      for (const call of delta?.tool_calls ?? []) {
        if (!calls.has(call.index)) {
          calls.set(call.index, call.id ?? `call_${call.index}`)
          yield* writer.toolStart(call.id ?? `call_${call.index}`, call.function?.name ?? '')
        }
        if (call.function?.arguments !== undefined) yield* writer.toolArgs(call.function.arguments)
      }
      if (choice?.finish_reason) finish = choice.finish_reason
      // Some servers send "usage": null on every chunk but the last.
      if (chunk.usage !== undefined && chunk.usage !== null) {
        yield { type: 'usage', usage: { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0, cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0 } }
      }
    }
    yield* writer.close()
    yield { type: 'finish', reason: finishReason(finish, writer.sawToolCall) }
  }
}

export function finishReason(reason: string | undefined, sawToolCall: boolean): { kind: 'stop' } | { kind: 'tool-calls' } | { kind: 'max-tokens' } {
  if (reason === 'length' || reason === 'max_tokens') return { kind: 'max-tokens' }
  if (sawToolCall || reason === 'tool_calls' || reason === 'tool_use') return { kind: 'tool-calls' }
  return { kind: 'stop' }
}

/** Workers AI through the AI binding (no key; billed to the Home's Cloudflare account). */
export class WorkersAiAdapter extends LlmAdapter {
  constructor(private readonly ai: Ai, private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow }, defaultMaxTokens: 8_000 } as never)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = await (this.ai.run as unknown as (model: string, input: unknown) => Promise<unknown>)(options.model, {
      messages: chatMessages(options, ''),
      ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: chatTools(options), tool_choice: 'auto' }),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    }).catch((error: unknown) => {
      throw new LlmError(`Workers AI: ${error instanceof Error ? error.message : String(error)}`, 'PROVIDER_ERROR')
    }) as {
      choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string | object } }> }; finish_reason?: string }>
      response?: string
      tool_calls?: Array<{ name: string; arguments: object }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const writer = new StreamWriter()
    const message = result.choices?.[0]?.message
    const reasoning = message?.reasoning_content
    if (typeof reasoning === 'string' && reasoning !== '') yield* writer.reasoning(reasoning)
    const text = message?.content ?? result.response
    if (typeof text === 'string' && text !== '') yield* writer.text_(text)
    const calls = message?.tool_calls ?? (result.tool_calls ?? []).map((call) => ({ id: undefined, function: { name: call.name, arguments: call.arguments } }))
    for (const [index, call] of calls.entries()) {
      yield* writer.toolStart(call.id ?? `call_${index}_${crypto.randomUUID().slice(0, 6)}`, call.function?.name ?? '')
      const args = call.function?.arguments
      yield* writer.toolArgs(typeof args === 'string' ? args : JSON.stringify(args ?? {}))
    }
    yield* writer.close()
    if (result.usage !== undefined) yield { type: 'usage', usage: { inputTokens: result.usage.prompt_tokens ?? 0, outputTokens: result.usage.completion_tokens ?? 0 } }
    yield { type: 'finish', reason: finishReason(result.choices?.[0]?.finish_reason, writer.sawToolCall) }
  }
}