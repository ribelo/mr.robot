/**
 * How a Robot's Host call fails across Durable Objects (deep review P16). The Member DO that owns the Host answers each call with a
 * HostCallReply: the value, or the expected failure as a Schema-encoded tagged value. The Robot decodes it back into the same tagged
 * error. Nothing is recognised by an error's name or message on the way; anything else thrown is a defect and stays thrown.
 */
import * as Schema from 'effect/Schema'

/** The Host is not connected now (or no Member owns it any more). */
export class HostOffline extends Schema.TaggedError<HostOffline>()('HostOffline', { message: Schema.String }) {}

/** The Robot may not use this Host any more: it is not among the Hosts its owner reaches (unpaired, no longer shared) or its grant is gone. */
export class HostAccessLost extends Schema.TaggedError<HostAccessLost>()('HostAccessLost', { message: Schema.String }) {}

/** The Host's app refused a change: the mode or the roots of the grant do not allow it. */
export class HostWriteDenied extends Schema.TaggedError<HostWriteDenied>()('HostWriteDenied', { message: Schema.String }) {}

/** The Host cannot confine a confined call: no usable sandbox, or an app too old to enforce the grant. The call is refused before it is sent, or by the app. */
export class HostNoSandbox extends Schema.TaggedError<HostNoSandbox>()('HostNoSandbox', { message: Schema.String }) {}

/** The app failed the call for another reason (an OS error, a copy that stopped), or the call got no answer while the Host stayed online. */
export class HostCallFailed extends Schema.TaggedError<HostCallFailed>()('HostCallFailed', { message: Schema.String }) {}

/** The Host's app speaks an older protocol than this Worker, so a call it does not know is not sent (v1.21, cw-jn59). */
export class HostOutdated extends Schema.TaggedError<HostOutdated>()('HostOutdated', { message: Schema.String }) {}

/** Every expected failure of a Host call. */
export const HostCallError = Schema.Union([HostOffline, HostAccessLost, HostWriteDenied, HostNoSandbox, HostCallFailed, HostOutdated])
export type HostCallError = typeof HostCallError.Type

/** What a Member DO answers a Host call with: what the Host answered, or why the call failed, encoded. */
export type HostCallReply<A> =
  | { readonly _tag: 'Answered'; readonly value: A }
  | { readonly _tag: 'Failed'; readonly error: typeof HostCallError.Encoded }

export const isHostCallError = Schema.is(HostCallError)
const encodeHostCallError = Schema.encodeSync(HostCallError)
const decodeHostCallError = Schema.decodeUnknownSync(HostCallError)

/**
 * The Member's side: a Host call as a reply. Only a HostCallError becomes a failed reply.
 * @throws whatever else the call throws: a defect, not a refusal.
 */
export async function replyOf<A>(call: Promise<A>): Promise<HostCallReply<A>> {
  try {
    return { _tag: 'Answered', value: await call }
  } catch (error) {
    if (isHostCallError(error)) return { _tag: 'Failed', error: encodeHostCallError(error) }
    throw error
  }
}

/**
 * The Robot's side: the value of a reply. The places are not Effect code, so a failed reply is thrown as the decoded tagged error.
 * @throws HostCallError for a failed reply.
 */
export function answerOf<A>(reply: HostCallReply<A>): A {
  if (reply._tag === 'Answered') return reply.value
  throw decodeHostCallError(reply.error)
}
