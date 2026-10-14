/**
 * The Home's pasted WireGuard configuration (v1.12 ticket 06, ux-t4wi, ux-a3ec): INI-like sections,
 * `key = value` lines and `#` comments, as Proton VPN writes them. Parsing returns only the public
 * summary (endpoint, server name, country); the keys stay in the sealed text. Pure functions.
 */
import type { VpnSummary } from '@mr-robot/protocol'

export type WireguardParse =
  | { readonly ok: true; readonly summary: VpnSummary }
  | { readonly ok: false; readonly reason: string }

interface Section {
  readonly name: string
  readonly comments: string[]
  readonly entries: Map<string, string>
}

/**
 * A Proton server name: an optional Secure Core entry country, the exit country, an optional FREE
 * tier, the number, an optional Tor suffix ("PL#45", "PL-FREE#12", "pl-free-12", "CH-PL#1", "CH#10-TOR").
 */
const PROTON_SERVER = /^(?:[A-Z]{2}-)?([A-Z]{2})(?:-FREE)?[#-]\d+(?:-TOR)?$/i
// Proton writes "UK" for the United Kingdom; ISO 3166-1 says GB.
const PROTON_COUNTRY: Readonly<Record<string, string>> = { UK: 'GB' }
const MAX_SERVER_NAME = 64

/** Parse a pasted configuration into its public summary, or say why it is not a WireGuard configuration. */
export function summarizeWireguard(text: string): WireguardParse {
  const preamble: Section = { name: '', comments: [], entries: new Map() }
  const sections: Section[] = []
  let current = preamble
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('#')) {
      current.comments.push(line.slice(1).trim())
      continue
    }
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header !== null) {
      current = { name: header[1]!.trim().toLowerCase(), comments: [], entries: new Map() }
      sections.push(current)
      continue
    }
    // wg-quick drops everything after a '#' on a value line.
    const pair = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line.split('#')[0]!.trim())
    if (pair === null || current === preamble) return { ok: false, reason: `Line ${index + 1} is not a [section], a # comment or a key = value line.` }
    current.entries.set(pair[1]!.toLowerCase(), pair[2]!.trim())
  }
  const interfaces = sections.filter((section) => section.name === 'interface')
  if (interfaces.length !== 1 || (interfaces[0]!.entries.get('privatekey') ?? '') === '') return { ok: false, reason: 'This is not a WireGuard configuration: it needs one [Interface] with PrivateKey.' }
  const peer = sections.find((section) => section.name === 'peer' && section.entries.has('endpoint'))
  if (peer === undefined) return { ok: false, reason: 'This is not a WireGuard configuration: it needs a [Peer] with Endpoint.' }
  const endpoint = parseEndpoint(peer.entries.get('endpoint')!)
  if (endpoint === undefined) return { ok: false, reason: 'The [Peer] Endpoint must be host:port.' }
  const serverName = serverNameOf(peer, [preamble, ...sections])
  const country = serverName === undefined ? undefined : countryOf(serverName)
  return { ok: true, summary: { endpoint, ...(serverName === undefined ? {} : { serverName }), ...(country === undefined ? {} : { country }) } }
}

/** host:port with a port in 1–65535; an IPv6 host is in brackets. */
function parseEndpoint(value: string): string | undefined {
  const match = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(value)
  if (match === null) return undefined
  const port = Number(match[2])
  return port >= 1 && port <= 65535 ? `${match[1]}:${port}` : undefined
}

/**
 * The server name Proton writes as a comment line: a comment shaped like a Proton server name
 * anywhere, else the [Peer]'s first comment that is not a `key = value` note. Never a key line.
 */
function serverNameOf(peer: Section, all: readonly Section[]): string | undefined {
  const named = all.flatMap((section) => section.comments).find((comment) => PROTON_SERVER.test(comment))
  if (named !== undefined) return named
  const first = peer.comments.find((comment) => comment !== '' && !comment.includes('='))
  return first === undefined ? undefined : first.slice(0, MAX_SERVER_NAME)
}

/** The exit country of a Proton server name, as ISO 3166-1 alpha-2. */
function countryOf(serverName: string): string | undefined {
  const match = PROTON_SERVER.exec(serverName)
  if (match === null) return undefined
  const code = match[1]!.toUpperCase()
  return PROTON_COUNTRY[code] ?? code
}
