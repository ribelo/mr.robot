/** The owner's time zone (v1.11 ticket 08): what counts as a zone. Pure functions. */

/** The zone every Member starts with, until the app reports its own. */
export const DEFAULT_TIME_ZONE = 'UTC'

// UTC, or Area/Location.
const IANA = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/

/** An IANA zone as the runtime knows it, or undefined for anything else (parse at the boundary). */
export function parseTimeZone(value: string): string | undefined {
  const text = value.trim()
  if (text !== 'UTC' && !IANA.test(text)) return undefined
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
