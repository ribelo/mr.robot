/**
 * A fake connector for the core tests (v1.5 ticket 01): one read tool that reports which account it
 * used and a hash of the token it received, and one write tool; its HTTP is a recorded fixture.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { ConnectorKind } from '@mr-robot/protocol'
import { connectorTools, request, type ConnectionUse, type ConnectorPlugin } from '../src/connectors/connector.ts'

/** Fakes the test Robot mounts in place of the real connectors, by kind. */
export const fakeConnectors = new Map<ConnectorKind, ConnectorPlugin>()

/** Recorded responses of the fake service, keyed by bearer token. */
export const fakeService = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const auth = new Headers(init?.headers).get('authorization') ?? ''
  const token = auth.replace(/^Bearer /, '')
  if (token === 'revoked-token') return Promise.resolve(Response.json({ error: 'invalid_token' }, { status: 401 }))
  return Promise.resolve(Response.json({ who: token === 'token-private' ? 'anna@private.test' : token === 'token-work' ? 'anna@work.test' : 'ben@home.test', url: String(input) }))
}

export function fakeConnector(kind: ConnectorKind): ConnectorPlugin {
  return {
    kind,
    tools: (host) => connectorTools(host, [
      {
        name: 'fake_whoami',
        description: 'Ask the service who this account is.',
        parameters: { properties: {} },
        action: () => 'whoami',
        run: (_args: Record<string, never>, use: ConnectionUse) => Effect.map(request(host.fetch, { method: 'GET', url: 'https://fake.test/me', headers: { authorization: `Bearer ${use.secrets['token']}` } }, Schema.Struct({ who: Schema.String })), (body) => `The service says: ${body.who} (token ${use.secrets['token']})`),
      },
      {
        name: 'fake_send',
        description: 'Send something.',
        write: true,
        parameters: { properties: { text: { type: 'string' } }, required: ['text'] },
        action: (args: { text: string }) => `send "${args.text}"`,
        run: () => Effect.succeed('sent'),
      },
    ] as never),
  }
}
