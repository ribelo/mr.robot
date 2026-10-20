/**
 * The refusals of the places (v1.16 ticket 01): each is a tagged error with the facts it is about, thrown by the places and turned into the
 * words a Robot reads at the tool boundary (placeErrorText). Nothing classifies an error by its message.
 */
import * as Data from 'effect/Data'

/** The call names a place the Robot holds no grant on. */
export class NoGrant extends Data.TaggedError('NoGrant')<{ readonly on: string; readonly what: string; readonly grant: string; readonly message: string }> {}

/** The call names a place that does not exist: not workspace, box or one of the owner's computers. */
export class UnknownPlace extends Data.TaggedError('UnknownPlace')<{ readonly on: string; readonly known: readonly string[]; readonly message: string }> {}

/** The call asks a place for what it cannot do (the Workspace runs no commands). */
export class WrongPlace extends Data.TaggedError('WrongPlace')<{ readonly on: string; readonly message: string }> {}

/** The path is a file the platform keeps in the Workspace; only the Workspace reaches it. */
export class OwnedPath extends Data.TaggedError('OwnedPath')<{ readonly path: string; readonly message: string }> {}

/** The path is read-only to the Robot (an owner's file, the product docs). */
export class ReadOnlyPath extends Data.TaggedError('ReadOnlyPath')<{ readonly path: string; readonly message: string }> {}

/** The path is not a file path inside the place. */
export class BadPath extends Data.TaggedError('BadPath')<{ readonly path: string; readonly message: string }> {}

/** The file is not there. */
export class MissingFile extends Data.TaggedError('MissingFile')<{ readonly place: string; readonly path: string; readonly message: string }> {}

/** The file is too large for the tool; a copy moves any size. */
export class FileTooLarge extends Data.TaggedError('FileTooLarge')<{ readonly path: string; readonly size: number; readonly message: string }> {}

/** The call is malformed in a way the tool schema cannot say (escalate without a reason, escalate on the Box). */
export class BadCall extends Data.TaggedError('BadCall')<{ readonly tool: string; readonly message: string }> {}

/** The computer has no usable sandbox (or an app too old to confine), so a confined call does not run. */
export class SandboxUnavailable extends Data.TaggedError('SandboxUnavailable')<{ readonly host: string; readonly message: string }> {}

/** The computer's app refused a change: the mode or the roots of the grant do not allow it. Escalate asks the owner to let it through once. */
export class WriteDenied extends Data.TaggedError('WriteDenied')<{ readonly host: string; readonly message: string }> {}

/** A copy that failed: the words say which end and why. */
export class CopyRefused extends Data.TaggedError('CopyRefused')<{ readonly message: string }> {}

export type PlaceError = NoGrant | UnknownPlace | WrongPlace | OwnedPath | ReadOnlyPath | BadPath | MissingFile | FileTooLarge | BadCall | SandboxUnavailable | WriteDenied | CopyRefused

/** Tools whose calls can ask for escalate, so that a denial can point at it. */
export const ESCALATING_TOOLS: readonly string[] = ['run', 'write', 'edit', 'delete_file', 'copy']

/** A defect helper for a switch over a closed union that missed a case. */
export function casesHandled(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`)
}

/** What the Robot reads for a refusal of `tool`. */
export function placeErrorText(error: PlaceError, tool: string): string {
  switch (error._tag) {
    case 'WriteDenied':
      return ESCALATING_TOOLS.includes(tool)
        ? `${error.message} If you need it, call ${tool} again with escalate: true and a reason: your owner is asked once, and when they approve it runs without the sandbox, that one time. Otherwise change where it writes.`
        : error.message
    case 'NoGrant': case 'UnknownPlace': case 'WrongPlace': case 'OwnedPath': case 'ReadOnlyPath': case 'BadPath':
    case 'MissingFile': case 'FileTooLarge': case 'BadCall': case 'SandboxUnavailable': case 'CopyRefused':
      return error.message
    default:
      return casesHandled(error)
  }
}

/** The tagged refusals of the places, and only those: anything else is not ours to word. */
export function isPlaceError(error: unknown): error is PlaceError {
  return error instanceof NoGrant || error instanceof UnknownPlace || error instanceof WrongPlace || error instanceof OwnedPath || error instanceof ReadOnlyPath
    || error instanceof BadPath || error instanceof MissingFile || error instanceof FileTooLarge || error instanceof BadCall || error instanceof SandboxUnavailable
    || error instanceof WriteDenied || error instanceof CopyRefused
}
