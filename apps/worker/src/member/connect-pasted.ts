/**
 * A Connection from the values of a paste form (cn-3cnb): the one path for values the person pasted
 * (POST /api/connections/<kind>) and values read from a browser after signing in under a Takeover
 * (v1.12 ticket 11). The form is parsed, sharing is refused for a person connection (ux-bk91), and
 * the Member DO checks the values with the service before it stores them.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import type { Env } from '../env.ts'
import { actsAsPerson, connectorOf, connectorPlugin } from '../plugins/catalog.ts'
import { parseForm } from '../connectors/schema-form.ts'
import type { ConnectorKind } from '@mr-robot/protocol'
import type { OwnConnection } from './connections.ts'

/** Why the values did not become a Connection: no such paste connector (404) or values refused (400). */
export class PasteRefused extends Data.TaggedError('PasteRefused')<{ readonly status: 400 | 404; readonly message: string }> {}

export interface PastedValues {
  readonly label?: string
  readonly shared: boolean
  readonly values: Readonly<Record<string, string>>
}

/** Why a connection may not be shared with the Home, or undefined when it may (ux-bk91). */
export function sharingRefusal(kind: ConnectorKind, shared: boolean): string | undefined {
  return shared && actsAsPerson(kind) ? `a ${connectorPlugin(kind)?.title ?? kind} connection acts as you, so it cannot be shared with the Home` : undefined
}

export const connectPastedValues = (env: Env, memberId: string, kind: string, paste: PastedValues): Effect.Effect<OwnConnection, PasteRefused> => Effect.gen(function* () {
  const found = connectorOf(kind)
  const connect = found?.connector.connect
  if (found === undefined || connect === undefined || connect.method !== 'paste') return yield* new PasteRefused({ status: 404, message: 'this connector does not connect by pasting' })
  const refusal = sharingRefusal(found.connector.kind, paste.shared)
  if (refusal !== undefined) return yield* new PasteRefused({ status: 400, message: refusal })
  const parsed = parseForm(found.plugin.name, connect.schema, paste.values, new Set())
  if (!parsed.ok) return yield* new PasteRefused({ status: 400, message: parsed.error.message })
  return yield* Effect.tryPromise({
    try: () => env.MEMBER.getByName(memberId).connectPasted({ kind: found.connector.kind, label: paste.label ?? null, shared: paste.shared, services: [], secrets: parsed.secrets }),
    catch: (error) => new PasteRefused({ status: 400, message: error instanceof Error ? error.message : String(error) }),
  })
})
