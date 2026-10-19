import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** One scripted model reply: text, or tool calls. */
export type StubReply =
  | { readonly text: string; readonly inputTokens?: number; readonly thinking?: string; /** Tool calls after the text: the text is an interim message of the Turn. */ readonly calls?: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  | { readonly hang: true }
  | { readonly calls: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  /** The model call waits until the gate opens, then replies: a Turn that is working while the test acts. */
  | { readonly gate: Promise<unknown>; readonly then: StubReply }
  | ((request: GenerateOptions) => StubReply)

/** Per-robot scripts, shared by the test and the Robot DO (same isolate under vitest-plugin). */
export const scripts = new Map<string, StubReply[]>()
/** Providers whose Turns run on this stub; a test may add one (Workers AI has no binding in tests). */
export const scriptedProviders = new Set<string>(['stub'])
export const requests = new Map<string, GenerateOptions[]>()

export class StubLlm extends LlmAdapter {
  constructor(private readonly robotId: string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, contextWindow: 128_000 } as LlmResolvedModelInfo)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // A Subagent's requests have their own script and log: "<robot id>:sub" (v1.14 ticket 06).
    const key = String(options.sessionId ?? '').startsWith('sa-') ? `${this.robotId}:sub` : this.robotId
    const log = requests.get(key) ?? []
    log.push(options)
    requests.set(key, log)
    let scripted = scripts.get(key)?.shift() ?? scripts.get('*')?.[0] ?? { text: 'ok' }
    // A cancelled call stops waiting at its gate, as a real model call would.
    const aborted = new Promise<never>((_resolve, reject) => {
      if (options.signal?.aborted === true) reject(new Error('aborted'))
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    aborted.catch(() => undefined)
    while (typeof scripted !== 'function' && 'gate' in scripted) {
      await Promise.race([scripted.gate, aborted])
      scripted = scripted.then
    }
    const reply = typeof scripted === 'function' ? scripted(options) : scripted
    if (typeof reply === 'function' || 'gate' in reply) throw new Error('StubLlm: a scripted reply function must return a plain reply')
    if ('hang' in reply) {
      await aborted
      return
    }
    if ('text' in reply) {
      const offset = reply.thinking === undefined ? 0 : 1
      if (reply.thinking !== undefined) {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index: 0, text: reply.thinking }
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reply.thinking } }
      }
      yield { type: 'block-start', index: offset, blockType: 'text' }
      yield { type: 'text-delta', index: offset, text: reply.text }
      yield { type: 'block-end', index: offset, block: { type: 'text', text: reply.text } }
      for (const [index, call] of (reply.calls ?? []).entries()) {
        const id = ToolCallId(`call-${crypto.randomUUID()}`)
        const args = JSON.stringify(call.args)
        yield { type: 'block-start', index: offset + 1 + index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: offset + 1 + index, id, name: call.name, argumentsDelta: args }
        yield { type: 'block-end', index: offset + 1 + index, block: { type: 'tool-call', id, name: call.name, arguments: args } }
      }
      yield { type: 'usage', usage: { inputTokens: reply.inputTokens ?? 100, outputTokens: 10 } }
      yield { type: 'finish', reason: { kind: (reply.calls ?? []).length > 0 ? 'tool-calls' : 'stop' } }
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