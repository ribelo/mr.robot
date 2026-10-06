/**
 * OpenAI Responses on a ChatGPT subscription (robot-lzu3): the Codex backend with the OAuth
 * access token and account id; encrypted reasoning items are replayed through DSH's replay state.
 */
import { LlmAdapter, LlmError, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { finishReason } from './openai-chat.ts'
import { httpFailure, replayBlocks, sse, StreamWriter, systemText, textOf } from './stream.ts'

const URL_ = 'https://chatgpt.com/backend-api/codex/responses'

type Item =
  | { type: 'message'; role: 'user' | 'assistant'; content: Array<{ type: 'input_text' | 'output_text'; text: string }> }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'reasoning'; encrypted_content: string; summary: Array<{ type: 'summary_text'; text: string }> }

function inputItems(options: GenerateOptions): Item[] {
  const items: Item[] = []
  for (const message of options.messages) {
    if (message.role === 'user') items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: textOf(message.content) }] })
    else if (message.role === 'tool') items.push({ type: 'function_call_output', call_id: message.toolCallId, output: textOf(message.content) })
    else if (message.role === 'assistant') {
      const sameProvider = (message as { source?: { provider?: string } }).source?.provider === options.provider
      const replay = sameProvider ? replayBlocks(message) : []
      for (const [index, block] of message.content.entries()) {
        if (block.type === 'text' && block.text !== '') items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text }] })
        if (block.type === 'tool-call') items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments })
        const encrypted = (replay[index] as { encrypted?: string } | null | undefined)?.encrypted
        if (block.type === 'reasoning' && encrypted !== undefined) items.push({ type: 'reasoning', encrypted_content: encrypted, summary: [] })
      }
    }
  }
  return items
}

/** Where and how a Responses request goes. */
export interface ResponsesEndpoint {
  readonly url: string
  readonly headers: (options: GenerateOptions) => Promise<Record<string, string>>
  readonly fetch?: typeof fetch
}

/** The ChatGPT subscription's Codex backend (OAuth access token and account id). */
export function chatgptSubscription(credential: () => Promise<{ access: string; accountId?: string }>): ResponsesEndpoint {
  return {
    url: URL_,
    headers: async (options) => {
      const { access, accountId } = await credential()
      return {
        authorization: `Bearer ${access}`,
        ...(accountId === undefined ? {} : { 'chatgpt-account-id': accountId }),
        originator: 'pi',
        'OpenAI-Beta': 'responses=experimental',
        ...(options.sessionId === undefined ? {} : { 'session-id': String(options.sessionId) }),
      }
    },
  }
}

export class CodexAdapter extends LlmAdapter {
  constructor(private readonly endpoint: ResponsesEndpoint, private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider, id: model, name: model,
      context: { contextWindow: this.contextWindow },
      defaultMaxTokens: 32_000,
      reasoning: { efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id })) },
    } as never)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const effort = options.reasoningEffort === undefined ? 'medium' : String(options.reasoningEffort)
    const response = await (this.endpoint.fetch ?? fetch)(this.endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(await this.endpoint.headers(options)) },
      body: JSON.stringify({
        model: options.model,
        store: false,
        stream: true,
        instructions: systemText(options),
        input: inputItems(options),
        tools: (options.tools ?? []).map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
        tool_choice: 'auto',
        parallel_tool_calls: true,
        reasoning: { effort: effort === 'off' ? 'low' : effort === 'max' ? 'high' : effort, summary: 'auto' },
        include: ['reasoning.encrypted_content'],
        ...(options.sessionId === undefined ? {} : { prompt_cache_key: String(options.sessionId) }),
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok || response.body === null) {
      await httpFailure('OpenAI', response)
      return
    }
    const writer = new StreamWriter()
    let status: string | undefined
    for await (const event of sse(response.body)) {
      const data = JSON.parse(event.data) as Record<string, any>
      switch (data['type']) {
        case 'response.output_item.added': {
          const item = data['item'] ?? {}
          if (item.type === 'function_call') yield* writer.toolStart(item.call_id, item.name)
          break
        }
        case 'response.output_text.delta':
          yield* writer.text_(data['delta'] ?? '')
          break
        case 'response.reasoning_summary_text.delta':
          yield* writer.reasoning(data['delta'] ?? '')
          break
        case 'response.function_call_arguments.delta':
          yield* writer.toolArgs(data['delta'] ?? '')
          break
        case 'response.output_item.done': {
          const item = data['item'] ?? {}
          if (item.type === 'reasoning') {
            if (writer.openKind !== 'reasoning') yield* writer.reasoning('')
            yield* writer.close(typeof item.encrypted_content === 'string' ? { encrypted: item.encrypted_content } : null)
          } else {
            yield* writer.close()
          }
          break
        }
        case 'response.completed':
        case 'response.incomplete': {
          const usage = data['response']?.usage
          status = data['response']?.incomplete_details?.reason === 'max_output_tokens' ? 'length' : undefined
          if (usage !== undefined) {
            yield { type: 'usage', usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, cacheReadTokens: usage.input_tokens_details?.cached_tokens ?? 0 } }
          }
          break
        }
        case 'response.failed':
        case 'error':
          throw new LlmError(`OpenAI: ${data['response']?.error?.message ?? data['message'] ?? 'request failed'}`, 'PROVIDER_ERROR')
      }
    }
    yield* writer.close()
    yield { type: 'finish', reason: finishReason(status, writer.sawToolCall), replayState: { response: null, blocks: writer.replay } }
  }
}
