/** Calls to Google APIs with a connection's access token (v1.5). */
import type * as Effect from 'effect/Effect'
import type * as Schema from 'effect/Schema'
import { request, requestBytes, type ConnectionUse, type ConnectorFailure, type ConnectorHost, type HttpCall } from '../connector.ts'

export function google<S extends Schema.Top>(host: ConnectorHost, use: ConnectionUse, call: Omit<HttpCall, 'headers'> & { readonly headers?: Readonly<Record<string, string>> }, schema: S): Effect.Effect<S['Type'], ConnectorFailure> {
  return request(host.fetch, { ...call, headers: { authorization: `Bearer ${use.secrets['accessToken'] ?? ''}`, ...call.headers } }, schema)
}

export function googleBytes(host: ConnectorHost, use: ConnectionUse, url: string) {
  return requestBytes(host.fetch, { method: 'GET', url, headers: { authorization: `Bearer ${use.secrets['accessToken'] ?? ''}` } })
}

export const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}
