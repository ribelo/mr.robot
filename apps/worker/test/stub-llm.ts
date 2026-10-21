import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SAFETY_NET_PREFIX } from '../src/agent/say.ts'

/** One scripted model reply: text, or tool calls. */
export type StubReply =
  | { readonly text: string; readonly inputTokens?: number; readonly thinking?: string; /** Tool calls after the text: the text is an interim message of the Turn. */ readonly calls?: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  | { readonly hang: true }
  /** The Robot says this (a say call); the request after the call, which carries its result, is answered with an empty end without using up the script. */
  | { readonly say: string; readonly attachments?: readonly string[]; readonly channel?: string }
  | { readonly calls: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  /** The model call waits until the gate opens, then replies: a Turn that is working while the test acts. */
  | { readonly gate: Promise<unknown>; readonly then: StubReply }
  | ((request: GenerateOptions) => StubReply)

/** Per-robot scripts, shared by the test and the Robot DO (same isolate under vitest-plugin). */
export const scripts = new Map<string, StubReply[]>()
/** Providers whose Turns run on this stub; a test may add one (Workers AI has no binding in tests). */
export const scriptedProviders = new Set<string>(['stub'])
export const requests = new Map<string, GenerateOptions[]>()
/**
 * The platform's one step after a Turn that said nothing (v1.15 ticket 02) is not part of a test's script: the model declines it
 * (empty text) unless the test scripts it in stepScripts, and its requests are kept apart in stepRequests, so the scripts and
 * request logs of tests about other things stay as they were.
 */
export const stepScripts = new Map<string, StubReply[]>()
/** Robots whose last reply was a scripted say: their next request ends the Turn. */
const sayEnds = new Set<string>()
export const stepRequests = new Map<string, GenerateOptions[]>()

/**
 * The Wake-up a request carries: its last user message that is not a context reminder. Since v1.15 every Robot has the skill tool, so
 * the skill catalog is a reminder in every context, after the Wake-up of the first Turn.
 */
export function wakeOf(request: GenerateOptions): GenerateOptions['messages'][number] | undefined {
  // The baselines the platform adds after a Wake-up (the memory, the Workspace instructions) are not the Wake-up; a memory change note
  // is read with it, as a test of a change expects.
  const context = (message: unknown) => { const source = (message as { source?: { memory?: unknown; workspaceInstructions?: unknown } }).source; return source?.memory === 'baseline' || source?.workspaceInstructions !== undefined }
  return request.messages.filter((message) => message.role === 'user' && !JSON.stringify(message).includes('<available_skills>') && !context(message)).at(-1)
}

function isSafetyNetStep(options: GenerateOptions): boolean {
  const last = options.messages.at(-1)
  // The step is the last message and begins with the notice (after its label line); a transcript that mentions an earlier step is not one.
  return last?.role === 'user' && last.content.some((block) => block.type === 'text' && block.text.replace(/^\[[^\n]*\]\n/, '').startsWith(SAFETY_NET_PREFIX))
}

/**
 * Code mode (v1.20.1): while programmed.on, when the request offers run_code and not a scripted tool, the scripted calls of one step
 * become one run_code program that makes them in order, each failure caught and returned as "Error: <message>", so a script reads the
 * same in both modes. The tests that run in both modes switch it on.
 */
export const programmed = { on: false }

function inCodeMode(options: GenerateOptions, reply: StubReply): StubReply {
  if (!programmed.on || typeof reply === 'function' || !('calls' in reply) || reply.calls === undefined || reply.calls.length === 0) return reply
  const offered = new Set((options.tools ?? []).map((definition) => definition.name))
  if (!offered.has('run_code') || reply.calls.every((call) => call.name === 'run_code' || offered.has(call.name))) return reply
  const lines = reply.calls.map((call) => `try { out.push(await tools[${JSON.stringify(call.name)}](${JSON.stringify(call.args)})) } catch (error) { out.push('Error: ' + (error instanceof Error ? error.message : String(error))) }`)
  const program = { name: 'run_code', args: { code: ['const out = []', ...lines, 'return out'].join('\n'), description: reply.calls.map((call) => call.name).join(', ') } }
  return 'text' in reply ? { ...reply, calls: [program] } : { calls: [program] }
}

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
    const step = isSafetyNetStep(options)
    const log = (step ? stepRequests : requests).get(key) ?? []
    log.push(options)
    ;(step ? stepRequests : requests).set(key, log)
    let scripted: StubReply = step ? stepScripts.get(key)?.shift() ?? { text: '' } : sayEnds.delete(key) ? { text: '' } : scripts.get(key)?.shift() ?? scripts.get('*')?.[0] ?? { text: 'ok' }
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
    let reply = typeof scripted === 'function' ? scripted(options) : scripted
    if (typeof reply !== 'function' && 'say' in reply) {
      sayEnds.add(key)
      const args = { text: reply.say, ...(reply.attachments === undefined ? {} : { attachments: reply.attachments }), ...(reply.channel === undefined ? {} : { channel: reply.channel }) }
      // In code mode only run_code is called: the program says it.
      const offered = new Set((options.tools ?? []).map((definition) => definition.name))
      reply = offered.has('run_code') && !offered.has('say')
        ? { calls: [{ name: 'run_code', args: { code: `return await tools.say(${JSON.stringify(args)})`, description: 'say' } }] }
        : { calls: [{ name: 'say', args }] }
    }
    if (typeof reply === 'function' || 'gate' in reply) throw new Error('StubLlm: a scripted reply function must return a plain reply')
    reply = inCodeMode(options, reply) as typeof reply
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