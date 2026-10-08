/**
 * A Robot's live feed as an atom (fe-xp06): every change the Robot DO announces refreshes that
 * Robot's atoms and the robot list; streaming text and thinking (pl-jzr7) are the atom's value.
 */
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { Atom, Reactivity } from 'effect/reactivity'
import { apiRuntime, keys } from './api-atoms.ts'
import { webSocketMessages } from './web-socket-stream.ts'

/** The reply being written now; null when nothing is streaming. */
export interface RobotFeed {
  readonly stream: { readonly text: string; readonly thinking: string } | null
  /** How many changes the Robot announced since the feed opened. */
  readonly changes: number
}

const StreamFrame = Schema.Struct({ type: Schema.Literal('stream'), text: Schema.optional(Schema.String), thinking: Schema.optional(Schema.String), done: Schema.optional(Schema.Boolean) })
const decodeStreamFrame = Schema.decodeUnknownOption(Schema.fromJsonString(StreamFrame))

const initial: RobotFeed = { stream: null, changes: 0 }

type FeedEvent = { readonly kind: 'changed' } | { readonly kind: 'stream'; readonly value: RobotFeed['stream'] }

export const robotFeedAtom = Atom.family((id: string) => apiRuntime.atom(
  webSocketMessages(`/api/robots/${encodeURIComponent(id)}/ws`).pipe(
    // A dropped connection (the phone slept, a deploy) comes back by itself.
    Stream.retry(Schedule.spaced('2 seconds')),
    Stream.mapEffect((text): Effect.Effect<FeedEvent, never, Reactivity.Reactivity> => {
      const frame = decodeStreamFrame(text)
      // Any other message (changed, screen, unknown kinds) means: read this Robot again.
      if (frame._tag === 'None') return Effect.as(Reactivity.invalidate([keys.robot(id), keys.robots]), { kind: 'changed' as const })
      return Effect.succeed({ kind: 'stream' as const, value: frame.value.done === true ? null : { text: frame.value.text ?? '', thinking: frame.value.thinking ?? '' } })
    }),
    Stream.scan(() => initial, (feed: RobotFeed, event: FeedEvent): RobotFeed => (event.kind === 'stream' ? { ...feed, stream: event.value } : { ...feed, changes: feed.changes + 1 })),
  ),
  { initialValue: initial },
))
