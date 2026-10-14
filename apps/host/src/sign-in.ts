/**
 * Sign-in windows for Slack and Discord as you (v1.12 ticket 10): which page to open, when the
 * person has reached the signed-in app, and how to read the session values from what the window
 * shows. Pure functions only; the window itself is in sign-in-window.ts.
 */

/** The ways to connect that have a sign-in window: connector kinds of the catalogue. */
export type SignInKind = 'slack' | 'discord-user'

export const isSignInKind = (value: unknown): value is SignInKind => value === 'slack' || value === 'discord-user'

/** Ten minutes without a signed-in session end the attempt. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000

export const SERVICE: Record<SignInKind, string> = { slack: 'Slack', 'discord-user': 'Discord' }

export const START_URL: Record<SignInKind, string> = { slack: 'https://slack.com/signin', 'discord-user': 'https://discord.com/login' }

/** What the page gets back. The values are the same fields the paste form asks for; they are never logged. */
export type SignInResult =
  | { readonly values: Readonly<Record<string, string>> }
  | { readonly timedOut: true }
  | { readonly cancelled: true }
  | { readonly error: string }

const parse = (url: string): URL | undefined => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/** The window may show web pages only: no slack://, discord:// or file:// hand-offs to other programs. */
export const isWebPage = (url: string): boolean => parse(url)?.protocol === 'https:'

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

/** Slack: the value of the `d` cookie (xoxd-…) as the browser stores it, the same text its developer tools show. */
export function slackCookie(cookies: ReadonlyArray<{ readonly name: string; readonly value: string; readonly domain?: string }>): string | undefined {
  return cookies.find((cookie) => cookie.name === 'd' && cookie.value.startsWith('xoxd-') && (cookie.domain ?? '').replace(/^\./, '').endsWith('slack.com'))?.value
}

/** Discord: the user token from the Authorization header the web app sends; a bot or OAuth header is not a user session. */
export function discordToken(authorization: string | undefined): string | undefined {
  const value = authorization?.trim()
  if (value === undefined || value === '' || /^(Bot|Bearer)\s/i.test(value)) return undefined
  return value
}

/** A request header by name, whatever its case. */
export function headerOf(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name)
  return found === undefined ? undefined : headers[found]
}

/** The default Electron user agent names the app and Electron; the services serve a plain Chrome page. */
export const withoutElectron = (userAgent: string): string => userAgent.replace(/\s(Electron|mr-robot-host|Mr\.?\s?Robot[^\s/]*)\/\S+/gi, '')
