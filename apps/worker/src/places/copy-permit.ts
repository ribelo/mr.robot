/**
 * The permit of one copy between the Workspace and the Box (deep review P4). A copy the Robot made runs ws on the Box for one Workspace key;
 * the door lets that ws through even when the files group is not at allow (at ask the owner approved the copy; a copy between the Box and a
 * Host needs no files group at all). The permit is a secret handed to that one ws process in its environment, never in a command line,
 * and it ends when the run of ws ends.
 *
 * A permit is bound to its copy's operations: a get permit fetches its key and nothing else; a put permit starts one upload of its key and
 * then only asks for the parts of that upload, completes it or aborts it. So a Box script that read the secret from the ws process can do
 * no more than the approved copy itself does.
 */
import * as Data from 'effect/Data'
import * as Schema from 'effect/Schema'
import { answer, type TransferRequest, type Transfers } from './transfers.ts'

/** The environment variable ws reads its permit from, and the header it sends it back in (infra/computer/ws-core.ts uses the same names). */
export const PERMIT_ENV = 'MR_ROBOT_PERMIT'
export const PERMIT_HEADER = 'x-mr-robot-permit'

/** 32 random bytes in hex. */
export const PermitSecret = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand('PermitSecret'))
export type PermitSecret = typeof PermitSecret.Type

/** The permit header of a request, when it is shaped like a secret. */
export function permitSecret(header: string | null): PermitSecret | undefined {
  const parsed = Schema.decodeUnknownOption(PermitSecret)(header)
  return parsed._tag === 'Some' ? parsed.value : undefined
}

/** The request is outside what the copy's permit covers. */
export class PermitRefused extends Data.TaggedError('PermitRefused')<{ readonly message: string }> {}

/** Where a put permit's one upload is: not asked for yet, asked for (its plan not back yet), or started with this upload id (none for a single PUT). */
type Upload =
  | { readonly _tag: 'NotStarted' }
  | { readonly _tag: 'Starting' }
  | { readonly _tag: 'Started'; readonly uploadId: string | undefined }

/** What the one ws run of a copy may ask the door for. */
type Permit =
  | { readonly op: 'get'; readonly key: string }
  | { readonly op: 'put'; readonly key: string; upload: Upload }

/** A permit the door found for a request: it carries the request out, or refuses it with PermitRefused. */
export interface CopyPermit {
  carry(request: TransferRequest, transfers: Transfers): Promise<unknown>
}

const refused = (permit: Permit, request: TransferRequest): PermitRefused =>
  new PermitRefused({ message: `this ws runs for one copy, which may only ${permit.op === 'get' ? 'fetch' : 'upload'} "${permit.key}" in your Workspace; it cannot ${request.op} ${request.path === undefined || request.path === '' ? 'there' : `"${request.path}"`}` })

async function carry(permit: Permit, request: TransferRequest, transfers: Transfers): Promise<unknown> {
  if (request.op === 'ls' || request.op === 'rm' || request.path !== permit.key) throw refused(permit, request)
  if (permit.op === 'get') {
    if (request.op !== 'get') throw refused(permit, request)
    return answer(transfers, request)
  }
  const upload = permit.upload
  if (request.op === 'put') {
    if (upload._tag !== 'NotStarted') throw new PermitRefused({ message: `this ws runs for one copy, and its upload of "${permit.key}" has already started` })
    // Claimed before the first await: a second put with the same permit finds the upload starting.
    permit.upload = { _tag: 'Starting' }
    try {
      const plan = await transfers.upload(request.path, request.size)
      permit.upload = { _tag: 'Started', uploadId: plan.uploadId }
      return plan
    } catch (error) {
      permit.upload = { _tag: 'NotStarted' }
      throw error
    }
  }
  if (request.op === 'get' || upload._tag !== 'Started' || request.uploadId !== upload.uploadId) throw refused(permit, request)
  return answer(transfers, request)
}

/** The permits of the copies in flight, by secret. */
export class CopyPermits {
  private readonly open = new Map<PermitSecret, Permit>()

  /** A permit for one run of ws: `get` fetches `key` to the Box, `put` uploads it. Give the secret to that process only; end the permit when the run ends. */
  issue(op: 'get' | 'put', key: string): { readonly secret: PermitSecret; end(): void } {
    const secret = Schema.decodeUnknownSync(PermitSecret)([...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
    this.open.set(secret, op === 'get' ? { op, key } : { op, key, upload: { _tag: 'NotStarted' } })
    return { secret, end: () => { this.open.delete(secret) } }
  }

  /** The permit of a copy in flight; undefined when the secret names none (any more). */
  find(secret: PermitSecret): CopyPermit | undefined {
    const permit = this.open.get(secret)
    return permit === undefined ? undefined : { carry: (request, transfers) => carry(permit, request, transfers) }
  }
}
