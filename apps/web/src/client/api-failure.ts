/**
 * How a call to the Mr. Robot API can fail (fe-tln3). Each failure is a value the screen renders;
 * classification uses the tag, never the message text.
 */
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Exit from 'effect/Exit'

/** The server answered with an error status; message is the server's explanation. */
export class ApiRejected extends Data.TaggedError('ApiRejected')<{ readonly status: number; readonly message: string }> {}

/** The request did not reach the server or no answer came back. */
export class ApiUnreachable extends Data.TaggedError('ApiUnreachable')<{ readonly path: string; readonly cause: unknown }> {}

/** The server answered, but the body does not match the protocol Schema for this endpoint. */
export class ApiResponseInvalid extends Data.TaggedError('ApiResponseInvalid')<{ readonly path: string; readonly cause: unknown }> {}

export type ApiFailure = ApiRejected | ApiUnreachable | ApiResponseInvalid

/** The sentence a person reads for a failure. */
export function describeFailure(failure: ApiFailure): string {
  switch (failure._tag) {
    case 'ApiRejected': return failure.message
    case 'ApiUnreachable': return 'the server cannot be reached; check the connection and try again'
    case 'ApiResponseInvalid': return 'the server sent an answer this page does not understand; reload the page'
  }
}

/** The sentence to show when a command's Exit failed, or undefined when it succeeded. */
export function exitFailure(exit: Exit.Exit<unknown, ApiFailure>): string | undefined {
  if (Exit.isSuccess(exit)) return undefined
  const failure = Cause.findErrorOption(exit.cause)
  return failure._tag === 'Some' ? describeFailure(failure.value) : 'it did not work; try again'
}
