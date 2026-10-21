/**
 * A year of a busy Robot for the scale test (v1.19 ticket 01): DSH session events of the shapes a real Turn writes (captured from
 * the scripted model), a Turn being an owner message, a file read, a say and the empty step that ends it, and a span being a run of
 * Turns closed by a compaction checkpoint over everything the model saw since the system prompt. The texts vary in length the way
 * owner messages, replies and file contents do; one early and one late Turn carry a word the search looks for.
 */

export interface StoredEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly startSeq: number; readonly endSeq: number }
  readonly sourceEventSeqs?: readonly number[]
  readonly ignorable?: true
}

export interface YearShape {
  readonly spans: number
  readonly turnsPerSpan: number
  /** The first and the last Turn's time. */
  readonly from: number
  readonly to: number
  readonly owner: { readonly memberId: string; readonly name: string }
  /** A word in an owner message of the third span, and one in a reply of the third last. */
  readonly early: string
  readonly late: string
}

/** Where the log stands: the next seq, the last Turn and the surface nodes (the first is the system prompt). */
export interface LogPosition {
  seq: number
  turn: number
  nodes: number[]
}

const WORDS = ('invoice tax apartment meeting dentist calendar report budget flight hotel train contract insurance garden heating ' +
  'school lunch bank transfer receipt quarterly supplier delivery parcel warranty renovation kitchen window landlord tenant ' +
  'deadline reminder summary draft review payment account balance pension mortgage offer price market notes weekly plan ' +
  'trip museum doctor pharmacy subscription renewal license permit council water electricity internet router password').split(' ')

/** A small deterministic generator (mulberry32), so every run seeds the same year. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function text(next: () => number, min: number, max: number): string {
  const length = min + Math.floor(next() * (max - min))
  const words: string[] = []
  let size = 0
  while (size < length) {
    const word = WORDS[Math.floor(next() * WORDS.length)]!
    words.push(word)
    size += word.length + 1
  }
  return words.join(' ')
}

const id = (next: () => number) => `${Math.floor(next() * 2 ** 32).toString(16).padStart(8, '0')}-${Math.floor(next() * 2 ** 32).toString(16).padStart(8, '0')}`

function toolCallStream(time: number, callId: string, name: string, args: string) {
  return [
    { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
    { type: 'tool-call-chunks', time0: time, index: 0, dt: [], id: callId, name, args: [args] },
    { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: args } } },
    { type: 'chunk', time, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ]
}

function textStream(time: number, value: string) {
  return [
    { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: time, index: 0, dt: [], texts: [value] },
    { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: value } } },
    { type: 'chunk', time, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
}

const MODEL = { kind: 'model', provider: 'stub', model: 'stub' }

/** The events of each span in turn; position moves along as they are produced. */
export function* yearSpans(shape: YearShape, position: LogPosition): Generator<StoredEvent[]> {
  const next = random(19)
  const turns = shape.spans * shape.turnsPerSpan
  const step = (shape.to - shape.from) / Math.max(1, turns - 1)
  for (let span = 0; span < shape.spans; span += 1) {
    const events: StoredEvent[] = []
    let time = 0
    const push = (type: string, data: unknown, extra: Partial<Pick<StoredEvent, 'surfaceOp' | 'sourceEventSeqs' | 'ignorable'>> = {}): number => {
      const seq = position.seq
      events.push({ type, seq, time, data, ...extra })
      if (extra.surfaceOp === 'append') position.nodes.push(seq)
      position.seq += 1
      time += 40
      return seq
    }
    for (let index = 0; index < shape.turnsPerSpan; index += 1) {
      time = Math.round(shape.from + (span * shape.turnsPerSpan + index) * step)
      const turn = (position.turn += 1)
      const owner = text(next, 60, 400) + (span === 2 && index === 0 ? ` ${shape.early}` : '')
      const reply = text(next, 150, 900) + (span === shape.spans - 3 && index === 0 ? ` ${shape.late}` : '')
      const file = text(next, 1500, 4000)
      const message = {
        content: [{ type: 'text', text: `[${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC]\n${owner}` }],
        source: { kind: 'member', memberId: shape.owner.memberId, name: shape.owner.name, attachments: [] },
        role: 'user',
        id: id(next),
      }
      push('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
      push('turn/start', { turn })
      push('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
      push('step/start', { turn, step: 1 })
      push('user/message', message, { surfaceOp: 'append' })
      const readId = `call-${id(next)}`
      const readArgs = JSON.stringify({ on: 'workspace', file_path: 'notes/plan.md' })
      push('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: readId, name: 'read', arguments: readArgs }], source: MODEL, id: id(next) }, usage: { inputTokens: 100, outputTokens: 10 }, stream: toolCallStream(time, readId, 'read', readArgs) }, { surfaceOp: 'append' })
      const readCall = push('tool/call', { turn, step: 1, callId: readId, name: 'read', arguments: readArgs })
      push('tool/result', { turn, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: readId }, toolCallId: readId, content: [{ type: 'text', text: file }], isError: false, id: id(next) } }, { sourceEventSeqs: [readCall], surfaceOp: 'append' })
      push('step/end', { turn, step: 1 })
      push('step/start', { turn, step: 2 })
      const sayId = `call-${id(next)}`
      const sayArgs = JSON.stringify({ text: reply })
      push('assistant/message', { turn, step: 2, message: { role: 'assistant', content: [{ type: 'tool-call', id: sayId, name: 'say', arguments: sayArgs }], source: MODEL, id: id(next) }, usage: { inputTokens: 100, outputTokens: 10 }, stream: toolCallStream(time, sayId, 'say', sayArgs) }, { surfaceOp: 'append' })
      const sayCall = push('tool/call', { turn, step: 2, callId: sayId, name: 'say', arguments: sayArgs })
      push('plugin:mr-robot/say', { id: `say-${sayId}`, text: reply, attachments: [] }, { ignorable: true })
      push('tool/result', { turn, step: 2, message: { role: 'tool', source: { kind: 'tool', callId: sayId }, toolCallId: sayId, content: [{ type: 'text', text: '{\n  "said": true,\n  "attachments": 0\n}' }], isError: false, id: id(next) } }, { sourceEventSeqs: [sayCall], surfaceOp: 'append' })
      push('step/end', { turn, step: 2 })
      push('step/start', { turn, step: 3 })
      push('assistant/message', { turn, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: '' }], source: MODEL, id: id(next) }, usage: { inputTokens: 100, outputTokens: 10 }, stream: textStream(time, '') }, { surfaceOp: 'append' })
      push('step/end', { turn, step: 3 })
      push('turn/end', { turn, reason: { kind: 'completed' } })
    }
    // The compaction at the next Turn's start: one checkpoint over every node after the system prompt.
    const shadowed = position.nodes.slice(1)
    if (shadowed.length > 0) {
      const compactionId = id(next)
      const summary = [{ type: 'text', text: text(next, 1500, 3000) }]
      const start = push('compaction/start', { compactionId, turn: position.turn })
      const summarySeq = push('compaction/summary', { compactionId, summary, rawOutput: summary, llmStreamCall: true, shadowedRange: { start: shadowed[0], end: shadowed.at(-1) }, shadowedSeqs: shadowed, shadowedTokenCount: shadowed.length * 300, provider: 'stub', model: 'stub', maxTokens: 32000, usage: { inputTokens: 100, outputTokens: 10 } })
      const checkpoint = push('user/message', {
        content: [
          { type: 'text', text: 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.\n\n<compacted-summary>' },
          ...summary,
          { type: 'text', text: '</compacted-summary>' },
        ],
        source: { kind: 'compact-checkpoint', compactionId },
        role: 'user',
        id: id(next),
      }, { sourceEventSeqs: [start, summarySeq, ...shadowed], surfaceOp: { op: 'replace', startSeq: shadowed[0]!, endSeq: shadowed.at(-1)! } })
      push('compaction/end', { compactionId, turn: position.turn })
      position.nodes = [position.nodes[0]!, checkpoint]
    }
    yield events
  }
}
