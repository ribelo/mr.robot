/** A connector host for tool tests: recorded HTTP, an in-memory Workspace, status changes kept. */
import type { ConnectionStatus, ConnectorKind } from '@mr-robot/protocol'
import type { ConnectorHost, GrantedConnection } from '../src/connectors/connector.ts'
import { connectorFixtures } from './connector-fixtures.ts'

export function account(kind: ConnectorKind, label: string, address: string, services: string[], write = false, isDefault = true): GrantedConnection {
  return { id: `c-${label}`, kind, label, account: address, services, write, isDefault }
}

export function testHost(kind: ConnectorKind, accounts: GrantedConnection[], secrets: Record<string, Record<string, string>> = {}) {
  const files = new Map<string, Uint8Array>()
  const statuses: Array<{ id: string; status: ConnectionStatus; note: string }> = []
  const host: ConnectorHost = {
    kind,
    accounts,
    fetch: connectorFixtures.fetch,
    use: async (id) => ({ secrets: secrets[id] ?? { accessToken: `token-${id}`, token: `token-${id}`, cookie: `cookie-${id}` }, meta: {} }),
    markStatus: async (id, status, note) => { statuses.push({ id, status, note }) },
    saveFile: async (path, bytes) => { files.set(path, bytes); return path },
    readFile: async (path) => {
      const bytes = files.get(path)
      if (bytes === undefined) throw new Error(`no file ${path}`)
      return bytes
    },
  }
  return { host, files, statuses }
}

/** Run a tool by name with arguments; the result as JSON text. A failed call rejects (ts-jbep). */
export async function runTool(tools: ReadonlyArray<{ name: string; execute: (args: never, exec: never) => Promise<unknown> }>, name: string, args: Record<string, unknown>): Promise<string> {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`no tool ${name}; tools: ${tools.map((tool) => tool.name).join(', ')}`)
  const value = await found.execute(args as never, {} as never)
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export const decodeRaw = (raw: string): string => new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4)), (char) => char.charCodeAt(0)))
export const b64url = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A connector result without its account field; a list comes back as its items, a text as its message. */
export function bodyOf(text: string): any {
  const { account: _account, ...rest } = JSON.parse(text) as Record<string, unknown>
  const keys = Object.keys(rest)
  if (keys.length === 1 && keys[0] === 'items') return rest['items']
  if (keys.length === 1 && keys[0] === 'message') return rest['message']
  return rest
}
