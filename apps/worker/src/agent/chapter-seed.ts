/**
 * The seed of a Robot's next chapter (v1.19, ec-srfn): what the model sees at the end of the closing chapter, as the start of a new log.
 * After a compaction that is the system prompt, the checkpoint and what came after it: at most one context budget. Each message
 * on DSH's surface is written again as an append in surface order, with the request header its tool changes refer to; the
 * events the surface no longer shows (the shadowed history, the step and attempt records) stay in the closing chapter.
 * A closed Turn around it keeps DSH's turn numbers going, and the inherited marker ends it.
 */
import { foldSurface, SessionSeq, type SessionEvent, type SessionMessageProjection } from '@deepseek-ai/dsh-session'

export interface ChapterSeed {
  readonly events: SessionEvent[]
  /** Every seed event is inherited: the marker's seq. */
  readonly inheritedEventCount: number
}

type Loose = { type: string; seq: number; time: number; data: Record<string, unknown>; surfaceOp?: unknown; sourceEventSeqs?: unknown; ignorable?: true }

/** events: the closing chapter's whole log, no Turn open in it. */
export function chapterSeed(events: readonly SessionEvent[], projections: readonly SessionMessageProjection[] = []): ChapterSeed {
  const fold = foldSurface(events, projections)
  const log = events as unknown as readonly Loose[]
  const turn = log.reduce((last, event) => (event.type === 'turn/start' ? Math.max(last, Number(event.data['turn'])) : last), 0)
  const time = log.at(-1)?.time ?? Date.now()
  const out: Loose[] = []
  const push = (event: Omit<Loose, 'seq'>) => {
    out.push({ ...event, seq: out.length })
    return out.length - 1
  }
  push({ type: 'turn/start', time, data: { turn } })
  const header = log.findLast((event) => event.type === 'request/header')
  const headerSeq = header === undefined ? undefined : push({ type: 'request/header', time: header.time, data: { ...header.data, reason: 'initial' } })
  const context = log.findLast((event) => event.type === 'request/context')
  if (context !== undefined) push({ type: 'request/context', time: context.time, data: context.data })
  // A point between a tool call and its result (a Rewind into a step): the surface ends before the call that has no answer.
  const answered = new Set(fold.nodes.flatMap((seq) => {
    const event = log[seq]!
    return event.type === 'tool/result' ? [String((event.data['message'] as { toolCallId?: unknown } | undefined)?.toolCallId)] : []
  }))
  const open = fold.nodes.findIndex((seq) => {
    const event = log[seq]!
    const content = event.type === 'assistant/message' ? ((event.data['message'] as { content?: Array<{ type: string; id?: unknown }> } | undefined)?.content ?? []) : []
    return content.some((block) => block.type === 'tool-call' && !answered.has(String(block.id)))
  })
  const nodes = open < 0 ? fold.nodes : fold.nodes.slice(0, open)
  for (const seq of nodes) {
    const event = log[seq]!
    const projected = fold.projectedMessages.get(SessionSeq(seq)) as unknown as Record<string, unknown> | undefined
    if (event.type === 'user/message') {
      push({ type: event.type, time: event.time, data: projected ?? event.data, surfaceOp: 'append' })
      continue
    }
    const data: Record<string, unknown> = { ...event.data, ...(projected === undefined ? {} : { message: projected }) }
    if (event.type === 'developer/message' && data['headerSeq'] !== undefined) {
      // A tool addition names its tool's definition in an earlier header: the seed's header holds every current tool, and an
      // addition of a tool that is gone since says nothing the header does not.
      const tools = new Set((((header?.data['header'] as { tools?: Array<{ name: string }> } | undefined)?.tools) ?? []).map((tool) => tool.name))
      const message = data['message'] as { content: Array<{ type: string; toolName?: string }> }
      const content = message.content.filter((block) => block.type !== 'tool-addition' || tools.has(String(block.toolName)))
      if (content.length === 0) continue
      data['message'] = { ...message, content }
      if (headerSeq !== undefined && content.some((block) => block.type === 'tool-addition')) data['headerSeq'] = headerSeq
      else delete data['headerSeq']
    }
    push({ type: event.type, time: event.time, data, surfaceOp: 'append' })
  }
  push({ type: 'turn/end', time, data: { turn, reason: { kind: 'forked' } } })
  const marker = push({ type: 'session/end-seed', time, data: { inherited: true } })
  return { events: out as unknown as SessionEvent[], inheritedEventCount: marker }
}
