/**
 * A same-origin WebSocket as an Effect Stream of text messages: the only place the web app opens
 * a socket (fe-xp06). The socket closes when the stream's scope ends; a close from the server ends
 * the stream with WebSocketClosed, so callers choose whether to reconnect.
 */
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

export class WebSocketClosed extends Data.TaggedError('WebSocketClosed')<{ readonly path: string; readonly code: number }> {}

export interface WebSocketOptions {
  /** Sent as soon as the socket opens. */
  readonly greeting?: ReadonlyArray<string>
  /** Sent just before the socket is closed by this side. */
  readonly farewell?: string
  /** Messages to send; queued until the socket is open. */
  readonly outgoing?: Queue.Dequeue<string>
}

export function webSocketMessages(path: string, options: WebSocketOptions = {}): Stream.Stream<string, WebSocketClosed> {
  return Stream.callback<string, WebSocketClosed>((queue) => Effect.gen(function* () {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const pending: string[] = []
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(`${protocol}//${location.host}${path}`)),
      (opened) => Effect.sync(() => {
        try { if (options.farewell !== undefined && opened.readyState === WebSocket.OPEN) opened.send(options.farewell) } catch { /* closing */ }
        opened.close()
      }),
    )
    socket.onopen = () => {
      for (const message of options.greeting ?? []) socket.send(message)
      for (const message of pending.splice(0)) socket.send(message)
    }
    socket.onmessage = (event) => {
      if (typeof event.data === 'string' && event.data !== 'pong') Queue.offerUnsafe(queue, event.data)
    }
    socket.onclose = (event) => { Queue.failCauseUnsafe(queue, Cause.fail(new WebSocketClosed({ path, code: event.code }))) }
    const outgoing = options.outgoing
    if (outgoing !== undefined) {
      yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(outgoing), (message) => Effect.sync(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message)
        else pending.push(message)
      }))))
    }
  }))
}
