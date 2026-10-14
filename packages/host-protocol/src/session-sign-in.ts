/**
 * Signing in to Slack or Discord as the person (v1.12 tickets 10 and 11): which page to open, when
 * the person has reached the signed-in app, and how to read the values the paste form asks for from
 * what a browser holds. Pure functions shared by the desktop app's sign-in window and the Worker's
 * Takeover capture; neither ever logs or shows the values.
 */

/** The ways to connect that have a sign-in: connector kinds of the catalogue. */
export type SignInKind = 'slack' | 'discord-user'

export const isSignInKind = (value: unknown): value is SignInKind => value === 'slack' || value === 'discord-user'

/** Ten minutes without a signed-in session end the attempt. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

export const SERVICE: Record<SignInKind, string> = { slack: 'Slack', 'discord-user': 'Discord' }

export const START_URL: Record<SignInKind, string> = { slack: 'https://slack.com/signin', 'discord-user': 'https://discord.com/login' }

/**
 * Where a service keeps its session in a browser: cookies of its domain (and its subdomains) and the
 * localStorage of the origin its web app runs on.
 */
export interface SessionSite {
  readonly domain: string
  readonly storageOrigin: string
}

export const SESSION_SITE: Record<SignInKind, SessionSite> = {
  slack: { domain: 'slack.com', storageOrigin: 'https://app.slack.com' },
  'discord-user': { domain: 'discord.com', storageOrigin: 'https://discord.com' },
}

const parse = (url: string): URL | undefined => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/** Whether the page is the signed-in app (Slack: the web client; Discord: the channels view). */
export function reachedApp(kind: SignInKind, url: string): boolean {
  const page = parse(url)
  if (page === undefined) return false
  return kind === 'slack'
    ? page.hostname === 'app.slack.com' && page.pathname.startsWith('/client/')
    : page.hostname === 'discord.com' && page.pathname.startsWith('/channels/')
}

/**
 * Slack: the xoxc token of the workspace the person signed in to, from the app's localStorage
 * `localConfig_v2` ({ teams: { T…: { token } } }). The client URL names the workspace (/client/T…);
 * when it does not match one, the first workspace with a token.
 */
export function slackToken(localConfig: unknown, url: string): string | undefined {
  if (typeof localConfig !== 'string') return undefined
  let config: unknown
  try {
    config = JSON.parse(localConfig)
  } catch {
    return undefined
  }
  const teams = (config as { teams?: unknown } | null)?.teams
  if (typeof teams !== 'object' || teams === null) return undefined
  const tokens = Object.entries(teams).flatMap(([id, team]) => {
    const token = (team as { token?: unknown } | null)?.token
    return typeof token === 'string' && token.startsWith('xoxc-') ? [[id, token] as const] : []
  })
  const wanted = /^\/client\/([A-Z0-9]+)/.exec(parse(url)?.pathname ?? '')?.[1]
  return (tokens.find(([id]) => id === wanted) ?? tokens[0])?.[1]
}

/** A cookie as a browser reports it; only these fields are read. */
export interface BrowserCookie {
  readonly name: string
  readonly value: string
  readonly domain?: string
}

/** Slack: the value of the `d` cookie (xoxd-…) as the browser stores it, the same text its developer tools show. */
export function slackCookie(cookies: ReadonlyArray<BrowserCookie>): string | undefined {
  return cookies.find((cookie) => cookie.name === 'd' && cookie.value.startsWith('xoxd-') && (cookie.domain ?? '').replace(/^\./, '').endsWith('slack.com'))?.value
}

/** Discord: the user token from the Authorization header the web app sends; a bot or OAuth header is not a user session. */
export function discordToken(authorization: string | undefined): string | undefined {
  const value = authorization?.trim()
  if (value === undefined || value === '' || /^(Bot|Bearer)\s/i.test(value)) return undefined
  return value
}

/** Discord: the user token the web app keeps in localStorage under `token`, stored as a JSON string. */
export function discordStoredToken(stored: unknown): string | undefined {
  if (typeof stored !== 'string') return undefined
  let value: unknown = stored
  try {
    value = JSON.parse(stored)
  } catch {
    // A bare token, not JSON.
  }
  return typeof value === 'string' ? discordToken(value) : undefined
}

/** What a browser holds for one service: its page, its domain's cookies, and the localStorage of its storage origin. */
export interface HeldSession {
  readonly url: string
  readonly cookies: ReadonlyArray<BrowserCookie>
  readonly storage: Readonly<Record<string, string>>
}

/**
 * The paste form's values (Slack: token and cookie; Discord as you: token) from what the browser
 * holds; undefined while the person has not signed in.
 */
export function sessionValues(kind: SignInKind, held: HeldSession): Readonly<Record<string, string>> | undefined {
  if (kind === 'slack') {
    const token = slackToken(held.storage['localConfig_v2'], held.url)
    const cookie = slackCookie(held.cookies)
    return token === undefined || cookie === undefined ? undefined : { token, cookie }
  }
  const token = discordStoredToken(held.storage['token'])
  return token === undefined ? undefined : { token }
}
