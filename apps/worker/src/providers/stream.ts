/**
 * Shared plumbing for the hand-written Provider adapters: SSE parsing, DSH message access,
 * and a writer that turns provider deltas into DSH stream chunks with correct block indices.
 */
import { LlmError, ToolCallId, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

export interface SseEvent {
  readonly event: string | undefined
  readonly data: string
}

export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let event: string | undefined
  let data: string[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line === '') {
        if (data.length > 0) yield { event, data: data.join('\n') }
        event = undefined
        data = []
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''))
      }
      newline = buffer.indexOf('\n')
    }
  }
  if (data.length > 0) yield { event, data: data.join('\n') }
}

/** Fail a request the way DSH expects: an LlmError with a stable code and the HTTP status. */
export async function httpFailure(provider: string, response: Response): Promise<never> {
  const text = (await response.text().catch(() => '')).slice(0, 500)
  const code = response.status === 429 ? 'RATE_LIMIT'
    : response.status === 401 || response.status === 403 ? 'AUTH'
      : response.status >= 500 ? 'PROVIDER_ERROR'
        : response.status === 400 && /context|too long|maximum/i.test(text) ? 'CONTEXT_OVERFLOW'
          : 'PROVIDER_ERROR'
  throw new LlmError(`${provider} answered ${response.status}: ${text || response.statusText}`, code, { status: response.status } as never)
}

export type DshMessage = GenerateOptions['messages'][number]

export function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : block.type === 'image' || block.type === 'file' ? ['[attachment not shown to this model]'] : [])).join('\n')
}

/** The system prompt: DSH sends it as system-role messages (and optionally options.system). */
export function systemText(options: GenerateOptions): string {
  const parts = options.messages.filter((message) => message.role === 'system').map((message) => textOf(message.content))
  if (options.system !== undefined) parts.unshift(options.system)
  return parts.filter((part) => part.trim() !== '').join('\n\n')
}

export function replayBlocks(message: DshMessage): readonly unknown[] {
  const source = (message as { source?: { replayState?: { blocks?: readonly unknown[] } } }).source
  return source?.replayState?.blocks ?? []
}

/** Builds DSH stream chunks: one block at a time, with its index, deltas and final block. */
export class StreamWriter {
  private index = -1
  private kind: 'text' | 'reasoning' | 'tool-call' | undefined
  private text = ''
  private call: { id: string; name: string; args: string } | undefined
  readonly replay: unknown[] = [];

  *text_(delta: string): Generator<StreamChunk> {
    if (this.kind !== 'text') {
      yield* this.close()
      yield* this.open('text')
    }
    this.text += delta
    yield { type: 'text-delta', index: this.index, text: delta }
  }

  *reasoning(delta: string): Generator<StreamChunk> {
    if (this.kind !== 'reasoning') {
      yield* this.close()
      yield* this.open('reasoning')
    }
    this.text += delta
    yield { type: 'reasoning-delta', index: this.index, text: delta }
  }

  *toolStart(id: string, name: string): Generator<StreamChunk> {
    yield* this.close()
    yield* this.open('tool-call')
    this.call = { id, name, args: '' }
    yield { type: 'tool-call-delta', index: this.index, id: ToolCallId(id), name, argumentsDelta: '' }
  }

  *toolArgs(delta: string): Generator<StreamChunk> {
    if (this.call === undefined) return
    this.call.args += delta
    yield { type: 'tool-call-delta', index: this.index, id: ToolCallId(this.call.id), argumentsDelta: delta }
  }

  /** Close the current block; `replay` is adapter-private data stored for this block. */
  *close(replay: unknown = null): Generator<StreamChunk> {
    if (this.kind === undefined) return
    const block: ContentBlock = this.kind === 'tool-call'
      ? { type: 'tool-call', id: ToolCallId(this.call!.id), name: this.call!.name, arguments: this.call!.args === '' ? '{}' : this.call!.args }
      : this.kind === 'reasoning' ? { type: 'reasoning', text: this.text } : { type: 'text', text: this.text }
    yield { type: 'block-end', index: this.index, block }
    this.replay.push(replay)
    this.kind = undefined
    this.text = ''
    this.call = undefined
  }

  get openKind(): 'text' | 'reasoning' | 'tool-call' | undefined {
    return this.kind
  }

  get sawToolCall(): boolean {
    return this.calls > 0
  }

  private calls = 0

  private *open(kind: 'text' | 'reasoning' | 'tool-call'): Generator<StreamChunk> {
    this.index += 1
    this.kind = kind
    if (kind === 'tool-call') this.calls += 1
    yield { type: 'block-start', index: this.index, blockType: kind }
  }
}

/** Image bytes for an attachment reference (screenshots in the Robot's Workspace). */
export type ImageLoader = (attachmentId: string) => Promise<{ mediaType: string; base64: string } | undefined>
export type LoadedImages = ReadonlyMap<string, { mediaType: string; base64: string }>

/** Load every image the request carries, once, before the provider body is built. */
export async function loadImages(options: GenerateOptions, loader: ImageLoader | undefined): Promise<LoadedImages> {
  const loaded = new Map<string, { mediaType: string; base64: string }>()
  if (loader === undefined) return loaded
  const ids = new Set(options.messages.flatMap((message) => message.content.flatMap((block) => (block.type === 'image' && block.offloaded !== true ? [String(block.attachment.attachmentId)] : []))))
  await Promise.all([...ids].map(async (id) => {
    const image = await loader(id).catch(() => undefined)
    if (image !== undefined) loaded.set(id, image)
  }))
  return loaded
}

/** The images of a message, in order, that were loaded. */
export function imagesOf(content: readonly ContentBlock[], images: LoadedImages): Array<{ mediaType: string; base64: string }> {
  return content.flatMap((block) => (block.type === 'image' ? [images.get(String(block.attachment.attachmentId))].filter((image) => image !== undefined) : []))
}

/** Text of a message, with loaded images left out (they are sent as image parts). */
export function textWithoutImages(content: readonly ContentBlock[], images: LoadedImages): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : block.type === 'image' ? (images.has(String(block.attachment.attachmentId)) ? [] : ['[image not shown to this model]']) : block.type === 'file' ? ['[attachment not shown to this model]'] : [])).join('\n')
}
