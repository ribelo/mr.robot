/**
 * The sign-in window (v1.12 ticket 10): the person signs in to Slack or Discord in a window with
 * an isolated, in-memory session; when the page reaches the signed-in app the values the paste form
 * asks for are read, the window closes and the session is cleared. The values go to the page that
 * asked and nowhere else.
 *
 * Discord's token comes from the Authorization header the web app sends to discord.com/api (seen
 * with session.webRequest). That header is what Discord itself uses, so it does not depend on how
 * the app stores the token; the localStorage way needs an iframe workaround that Discord has broken before.
 */
import { BrowserWindow, session } from 'electron'
import { discordToken, headerOf, isWebPage, reachedApp, SERVICE, SIGN_IN_TIMEOUT_MS, slackCookie, slackToken, START_URL, withoutElectron, type SignInKind, type SignInResult } from './sign-in.ts'

/** Without the persist: prefix the partition lives in memory only. */
const PARTITION = 'mr-robot-sign-in'
const POLL_MS = 2000

let open: BrowserWindow | undefined

export function connectThroughSignIn(kind: SignInKind, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<SignInResult> {
  if (open !== undefined && !open.isDestroyed()) {
    open.show()
    open.focus()
    return Promise.resolve({ error: 'A sign-in window is already open.' })
  }
  return new Promise((resolve) => {
    let win: BrowserWindow
    const ses = session.fromPartition(PARTITION)
    try {
      ses.setUserAgent(withoutElectron(ses.getUserAgent()))
      ses.setPermissionRequestHandler((_contents, _permission, allow) => allow(false))
      win = new BrowserWindow({ width: 1000, height: 780, title: `Sign in to ${SERVICE[kind]}`, autoHideMenuBar: true, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    } catch (error) {
      resolve({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    open = win

    let settled = false
    let checking = false
    let seenDiscord: string | undefined
    const finish = (result: SignInResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      ses.webRequest.onBeforeSendHeaders(null)
      if (!win.isDestroyed()) win.close()
      // Cookies, local storage and caches of the sign-in go before the page hears the result.
      void Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]).catch(() => undefined).finally(() => {
        open = undefined
        resolve(result)
      })
    }

    const check = async (): Promise<void> => {
      if (settled || checking || win.isDestroyed()) return
      const url = win.webContents.getURL()
      if (!reachedApp(kind, url)) return
      checking = true
      try {
        if (kind === 'slack') {
          const token = slackToken(await win.webContents.executeJavaScript("localStorage.getItem('localConfig_v2')"), url)
          const cookie = slackCookie(await ses.cookies.get({ name: 'd' }))
          if (token !== undefined && cookie !== undefined) finish({ values: { token, cookie } })
        } else if (seenDiscord !== undefined) {
          finish({ values: { token: seenDiscord } })
        }
      } catch {
        // The page is still loading; the next navigation or tick tries again.
      } finally {
        checking = false
      }
    }

    if (kind === 'discord-user') {
      ses.webRequest.onBeforeSendHeaders({ urls: ['https://discord.com/api/*'] }, (details, answer) => {
        seenDiscord = discordToken(headerOf(details.requestHeaders, 'authorization')) ?? seenDiscord
        answer({ requestHeaders: details.requestHeaders })
      })
    }

    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)
    const poll = setInterval(() => void check(), POLL_MS)
    win.on('closed', () => finish({ cancelled: true }))
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load']) win.webContents.on(event, () => void check())
    // Only web pages: a hand-off such as slack:// never reaches another program. A new window opens in this one.
    const onlyWeb = (event: unknown, url: unknown): void => {
      if (typeof url !== 'string' || !isWebPage(url)) (event as { preventDefault(): void }).preventDefault()
    }
    win.webContents.on('will-navigate', onlyWeb)
    win.webContents.on('will-redirect', onlyWeb)
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebPage(url)) void win.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    // A page that does not load shows Chromium's error page; the person closes the window or the ten minutes end.
    void win.loadURL(START_URL[kind]).catch(() => undefined)
  })
}
