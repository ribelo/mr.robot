/**
 * The Box's door to its Workspace (v1.16 ticket 06, ob-63nt, ob-o6aw): ws calls it with the token written into the container at boot. The
 * token is good while the Robot's record says the Box is booting or running and its container is up; after a stop there is no token, and the
 * Workspace is out of reach again.
 *
 * A script in the Box has no owner to ask, so the door applies the Workspace rules of the tools the Robot's own calls meet (D1): the files
 * group must be usable at allow (at ask, a call waits for its owner and a script cannot; the door says so), and the same keys are writable.
 * The one exception is a copy the Robot made and its owner approved: it runs ws on the Box for one path, and only that path is open at ask.
 */
import { sameToken, type BoxToken } from '../box/token.ts'
import { casesHandled } from './errors.ts'
import { answer, httpStatus, isTransferFailure, parseTransferRequest, type Transfers } from './transfers.ts'

/** Whether the Robot may use the files group right now, from the Box's side. */
export type FilesAccess = 'allow' | 'ask' | 'none'

export interface BoxDoorDeps {
  /** The token of the Box this Robot's record says is booting or running; undefined when the Box is off. */
  liveToken(): BoxToken | undefined
  /** Whether the container answers, for a Box recorded as running. */
  containerUp(): Promise<boolean>
  filesAccess(): FilesAccess
  /** Whether a copy in flight has opened this Workspace path to ws. */
  permitted(path: string): boolean
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

/** Answer one request of ws. */
export async function boxTransfer(deps: BoxDoorDeps, token: BoxToken, body: string): Promise<DoorReply> {
  const live = deps.liveToken()
  if (live === undefined || !(await sameToken(token, live)) || !(await deps.containerUp())) return reply(401, { error: 'this token is not valid: the Box it was written for is not running' })
  try {
    const request = parseTransferRequest(parsedBody(body))
    const access = deps.filesAccess()
    switch (access) {
      case 'allow': break
      case 'ask':
        if (!deps.permitted(request.path ?? '')) return reply(403, { error: 'your Workspace files are at ask: your owner decides each use of them, and a script on the Box cannot be asked. Use copy, which asks your owner, or ask your owner for the tool group "files" at allow (propose_grants).' })
        break
      case 'none': return reply(403, { error: 'you hold no grant on your Workspace files (the tool group "files"). Your owner can give it: propose it with propose_grants.' })
      default: return casesHandled(access)
    }
    return reply(200, await answer(deps.transfers, request))
  } catch (error) {
    if (isTransferFailure(error)) return reply(httpStatus(error), { error: error.message })
    throw error
  }
}
