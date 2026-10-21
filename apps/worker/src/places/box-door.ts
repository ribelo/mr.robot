/**
 * The Box's door to its Workspace (v1.16 ticket 06, ob-63nt, ob-o6aw): ws calls it with the token written into the container at boot. The
 * token is good while the Robot's record says the Box is booting, running or stopping (it sends its caches then) and its container is up;
 * after a stop there is no token, and the Workspace is out of reach again.
 *
 * The door is open only while the Robot holds its Box (the box group usable, with the Space's plugin switches as they are now). A script in
 * the Box has no owner to ask, so the door applies the Workspace rules of the tools the Robot's own calls meet (D1): the files group must be
 * usable at allow (at ask, a call waits for its owner and a script cannot; the door says so), and the same keys are writable. The one
 * exception is a run of ws the Robot started itself (a copy, the caches' archive): it has a permit for its one key and its one direction
 * (copy-permit.ts), checked before the files group, since a copy between the Box and a Host needs no files group, a copy at ask was
 * approved by the owner, and the caches are the platform's.
 */
import { usableLevel, type GrantLevel } from '@mr-robot/protocol'
import { sameToken, type BoxToken } from '../box/token.ts'
import { casesHandled } from './errors.ts'
import { PermitRefused, type CopyPermit, type PermitSecret } from './copy-permit.ts'
import { answer, httpStatus, isTransferFailure, parseTransferRequest, type Transfers } from './transfers.ts'

export interface BoxDoorDeps {
  /** The token of the Box this Robot's record says is booting, running or stopping; undefined when the Box is off. */
  liveToken(): BoxToken | undefined
  /** Whether the container answers, for a Box recorded as running. */
  containerUp(): Promise<boolean>
  /** The levels of the files and box groups now: deny where the Space has the plugin off, read from the Space at each request. */
  levels(): Promise<{ readonly files: GrantLevel; readonly box: GrantLevel }>
  /** The permit of a copy in flight, by the secret its ws sent; undefined when there is none. */
  permit(secret: PermitSecret): CopyPermit | undefined
  readonly transfers: Transfers
}

/** What the edge sends back to ws. */
export interface DoorReply {
  readonly status: number
  readonly json: string
}

const reply = (status: number, value: unknown): DoorReply => ({ status, json: JSON.stringify(value) })

const parsedBody = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** Answer one request of ws; `permit` is the secret a copy's ws sends, absent for a script's. */
export async function boxTransfer(deps: BoxDoorDeps, token: BoxToken, permit: PermitSecret | undefined, body: string): Promise<DoorReply> {
  const live = deps.liveToken()
  if (live === undefined || !(await sameToken(token, live)) || !(await deps.containerUp())) return reply(401, { error: 'this token is not valid: the Box it was written for is not running' })
  try {
    const request = parseTransferRequest(parsedBody(body))
    const levels = await deps.levels()
    if (!usableLevel(levels.box)) return reply(403, { error: 'you hold no grant on your Box (the tool group "box"), so it does not reach your Workspace. Your owner can give it: propose it with propose_grants.' })
    const copy = permit === undefined ? undefined : deps.permit(permit)
    if (copy !== undefined) return reply(200, await copy.carry(request, deps.transfers))
    const files = levels.files
    switch (files) {
      case 'allow': break
      case 'ask': return reply(403, { error: 'your Workspace files are at ask: your owner decides each use of them, and a script on the Box cannot be asked. Use copy, which asks your owner, or ask your owner for the tool group "files" at allow (propose_grants).' })
      case 'deny': return reply(403, { error: 'you hold no grant on your Workspace files (the tool group "files"). Your owner can give it: propose it with propose_grants.' })
      default: return casesHandled(files)
    }
    return reply(200, await answer(deps.transfers, request))
  } catch (error) {
    if (error instanceof PermitRefused) return reply(403, { error: error.message })
    if (isTransferFailure(error)) return reply(httpStatus(error), { error: error.message })
    throw error
  }
}
