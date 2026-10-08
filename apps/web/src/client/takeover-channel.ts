/**
 * The takeover window's channel to the Robot's browser (fe-xp06): the socket's messages folded into
 * one state by a pure reducer, and a send queue for claims, taps and keys.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult, Atom } from 'effect/reactivity'
import { useCallback } from 'react'
import { webSocketMessages } from './web-socket-stream.ts'

export interface TakeoverState {
  readonly frame: { readonly src: string; readonly width: number; readonly height: number } | null
  readonly claimed: boolean
  readonly status: string
  readonly timing: string | null
  readonly message: string | null
  readonly logins: ReadonlyArray<{ readonly name: string; readonly username: string }> | null
  readonly closed: boolean
}

export const initialTakeover: TakeoverState = { frame: null, claimed: false, status: 'Opening the browser at its last page…', timing: null, message: null, logins: null, closed: false }

const TakeoverMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('frame'), data: Schema.String, metadata: Schema.optional(Schema.Struct({ deviceWidth: Schema.optional(Schema.Number), deviceHeight: Schema.optional(Schema.Number) })) }),
  Schema.Struct({ type: Schema.Literal('status'), text: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal('timing'), stages: Schema.Record(Schema.String, Schema.Number) }),
  Schema.Struct({ type: Schema.Literal('claimed') }),
  Schema.Struct({ type: Schema.Literal('logins'), entries: Schema.Array(Schema.Struct({ name: Schema.String, username: Schema.String })) }),
  Schema.Struct({ type: Schema.Literal('filled'), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal('claim-refused') }),
  Schema.Struct({ type: Schema.Literal('error'), message: Schema.String }),
])
type TakeoverMessage = typeof TakeoverMessage.Type
const decodeTakeoverMessage = Schema.decodeUnknownOption(Schema.fromJsonString(TakeoverMessage))

/** One socket message applied to the window's state; other kinds (changed, stream) leave it as it is. */
export function takeoverStep(state: TakeoverState, message: TakeoverMessage): TakeoverState {
  switch (message.type) {
    case 'frame': return { ...state, frame: { src: `data:image/jpeg;base64,${message.data}`, width: message.metadata?.deviceWidth ?? 1280, height: message.metadata?.deviceHeight ?? 800 } }
    case 'status': return { ...state, status: message.text ?? '' }
    case 'timing': return { ...state, timing: `Opened in ${((message.stages['firstFrame'] ?? 0) / 1000).toFixed(1)} s` }
    case 'claimed': return { ...state, claimed: true }
    case 'logins': return { ...state, logins: message.entries }
    case 'filled': return { ...state, message: message.message, logins: null }
    case 'claim-refused': return { ...state, message: 'Someone else is using this browser right now.' }
    case 'error': return { ...state, message: message.message }
  }
}

/** Outgoing messages per Robot; the queue outlives a reconnect of the same window. */
const outboxes = new Map<string, Queue.Queue<string>>()
function outbox(robotId: string): Queue.Queue<string> {
  let queue = outboxes.get(robotId)
  if (queue === undefined) {
    queue = Effect.runSync(Queue.unbounded<string>())
    outboxes.set(robotId, queue)
  }
  return queue
}

const takeoverAtom = Atom.family((robotId: string) => Atom.make(
  webSocketMessages(`/api/robots/${encodeURIComponent(robotId)}/ws`, {
    greeting: [JSON.stringify({ type: 'live', on: true })],
    // Closing the window hands the browser back (pl-glfh): the server sees the socket close.
    farewell: JSON.stringify({ type: 'live', on: false }),
    outgoing: outbox(robotId),
  }).pipe(
    Stream.map((text: string) => decodeTakeoverMessage(text)),
    Stream.filter(Option.isSome),
    Stream.map((message) => message.value),
    Stream.scan(() => initialTakeover, takeoverStep),
    Stream.catch(() => Stream.make({ ...initialTakeover, closed: true, status: 'The connection to the browser closed.' })),
  ),
  { initialValue: initialTakeover },
))

/** The takeover window's state and a way to send it input; the socket lives while the window is open. */
export function useTakeover(robotId: string): { readonly state: TakeoverState; readonly send: (input: Record<string, unknown>) => void } {
  const result = useAtomValue(takeoverAtom(robotId))
  const state = AsyncResult.getOrElse(result, () => initialTakeover)
  const send = useCallback((input: Record<string, unknown>) => { Queue.offerUnsafe(outbox(robotId), JSON.stringify(input)) }, [robotId])
  return { state, send }
}
