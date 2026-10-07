/**
 * Login entries (v1.1 ticket 05, rb-gq50): what used to be a secret, with the username, the
 * websites it belongs to and notes. An entry is stored sealed as JSON under its name; a value
 * stored before entries existed reads as an entry whose password is that value (rb-36g4).
 */

export interface LoginEntry {
  readonly username: string
  readonly password: string
  /** Addresses the entry belongs to; filling is allowed only on these registrable domains (rb-1dzv). */
  readonly websites: readonly string[]
  readonly notes: string
  /** The robot may read the raw value with secret_get (API keys and the like). */
  readonly allowRead: boolean
}

/** An entry without its password, as robots and lists see it. */
export type LoginMeta = Omit<LoginEntry, 'password'>

export function parseEntry(text: string): LoginEntry {
  if (text.startsWith('{"v":2,')) {
    try {
      const value = JSON.parse(text) as Partial<LoginEntry>
      return { username: value.username ?? '', password: value.password ?? '', websites: value.websites ?? [], notes: value.notes ?? '', allowRead: value.allowRead === true }
    } catch { /* a legacy value that happens to look like JSON */ }
  }
  // Stored before login entries: the value is the password, still readable as before.
  return { username: '', password: text, websites: [], notes: '', allowRead: true }
}

export function serializeEntry(entry: LoginEntry): string {
  return JSON.stringify({ v: 2, username: entry.username, password: entry.password, websites: entry.websites, notes: entry.notes, allowRead: entry.allowRead })
}

export function metaOf(entry: LoginEntry): LoginMeta {
  return { username: entry.username, websites: entry.websites, notes: entry.notes, allowRead: entry.allowRead }
}

/** Second-level labels under which registrations happen (enough for the sites a Home uses). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'biz', 'info', 'waw', 'krakow', 'gda', 'wroc', 'poznan'])

/** The registrable domain of an address or host ("online.mbank.pl" → "mbank.pl", "a.b.co.uk" → "b.co.uk"). */
export function registrableDomain(address: string): string | null {
  let host: string
  try {
    host = new URL(address.includes('://') ? address : `https://${address}`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return null
  }
  if (host === '' || /^[\d.]+$/.test(host) || host.includes(':')) return host || null
  const labels = host.split('.')
  if (labels.length <= 2) return host
  const take = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2
  return labels.slice(-take).join('.')
}

/** Whether an entry belongs to the page at this address. */
export function entryMatches(entry: Pick<LoginEntry, 'websites'>, url: string): boolean {
  const page = registrableDomain(url)
  return page !== null && entry.websites.some((site) => registrableDomain(site) === page)
}
