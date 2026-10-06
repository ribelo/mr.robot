import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** One scripted model reply: text, or tool calls. */
export type StubReply =
  | { readonly text: string }
  | { readonly hang: true }
  | { readonly calls: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  | ((request: GenerateOptions) => StubReply)

/** Per-robot scripts, shared by the test and the Robot DO (same isolate under vitest-plugin). */
export const scripts = new Map<string, StubReply[]>()
export const requests = new Map<string, GenerateOptions[]>()

export class StubLlm extends LlmAdapter {
  constructor(private readonly robotId: string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, contextWindow: 128_000 } as LlmResolvedModelInfo)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const log = requests.get(this.robotId) ?? []
    log.push(options)
    requests.set(this.robotId, log)
    const scripted = scripts.get(this.robotId)?.shift() ?? scripts.get('*')?.[0] ?? { text: 'ok' }
    const reply = typeof scripted === 'function' ? scripted(options) : scripted
    if (typeof reply === 'function') throw new Error('StubLlm: a scripted reply function must return a reply')
    if ('hang' in reply) {
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return
    }
    if ('text' in reply) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply.text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    for (const [index, call] of reply.calls.entries()) {
      const id = ToolCallId(`call-${crypto.randomUUID()}`)
      const args = JSON.stringify(call.args)
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: args }
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name: call.name, arguments: args } }
    }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}