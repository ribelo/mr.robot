/**
 * Sign-in windows for Slack and Discord as you (v1.12 ticket 10): what the window itself needs
 * beyond the shared rules in @mr-robot/host-protocol (which page to open, when the person has
 * reached the signed-in app, how to read the session values). Pure functions only; the window
 * itself is in sign-in-window.ts.
 */
export { discordToken, isSignInKind, reachedApp, SERVICE, SIGN_IN_TIMEOUT_MS, slackCookie, slackToken, START_URL, type SignInKind } from '@mr-robot/host-protocol'

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

/** A request header by name, whatever its case. */
export function headerOf(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name)
  return found === undefined ? undefined : headers[found]
}

/** The default Electron user agent names the app and Electron; the services serve a plain Chrome page. */
export const withoutElectron = (userAgent: string): string => userAgent.replace(/\s(Electron|mr-robot-host|Mr\.?\s?Robot[^\s/]*)\/\S+/gi, '')
