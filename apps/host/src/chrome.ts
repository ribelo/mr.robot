/**
 * The host browser (hs-zmbc): the installed Chrome or Chromium, started with its own "Mr. Robot"
 * profile and a visible window, DevTools on localhost only. It stays open between tasks.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, isAbsolute, join, win32 } from 'node:path'

/** Where Chrome installs on Windows: for all users (64 and 32 bit) and for the one user. */
export const windowsChromePaths = (env: NodeJS.ProcessEnv): string[] =>
  [env['ProgramFiles'], env['ProgramFiles(x86)'], env['LocalAppData']]
    .filter((root): root is string => root !== undefined && root !== '')
    .map((root) => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))

const CANDIDATES: Record<string, string[]> = {
  linux: ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  win32: windowsChromePaths(process.env),
}

/** The Chrome this host would use, or null. */
export function findChrome(): string | null {
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (isAbsolute(candidate)) {
      if (existsSync(candidate)) return candidate
      continue
    }
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      if (directory !== '' && existsSync(join(directory, candidate))) return join(directory, candidate)
    }
  }
  return null
}

/** A graphical session the browser can open a window in (a Windows desktop session always has one: the app itself runs in it). */
export function hasGraphicalSession(): boolean {
  return hasDisplay()
}

/**
 * Whether this process can show a window (v1.21, cw-ixto): the check asks for a display, not for the OS. Linux: an X or Wayland display
 * in the environment. macOS: a window-server (Aqua) session, which launchd agents of a logged-in user have and daemons do not. Windows:
 * an interactive session, which a service (session 0) has none of.
 */
export function hasDisplay(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, macSession: () => string = launchdSession): boolean {
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return Boolean(env['DISPLAY'] || env['WAYLAND_DISPLAY'])
  if (platform === 'darwin') return macSession() === 'Aqua'
  if (platform === 'win32') return Boolean(env['SESSIONNAME']) && env['SESSIONNAME'] !== 'Services'
  return false
}

/** The launchd session this process runs in (Aqua for a logged-in user's window server; Background or System for a daemon). */
function launchdSession(): string {
  const answer = spawnSync('launchctl', ['managername'], { encoding: 'utf8', timeout: 5000 })
  return answer.status === 0 ? answer.stdout.trim() : ''
}

export class HostChrome {
  private child: ChildProcess | undefined
  private endpoint: string | undefined

  constructor(private readonly profile: string) {}

  /** The browser-level DevTools WebSocket, starting Chrome when it is not running. */
  async devtools(): Promise<string> {
    if (this.endpoint !== undefined && this.child !== undefined && this.child.exitCode === null) return this.endpoint
    const binary = findChrome()
    if (binary === null) throw new Error('no Chrome or Chromium is installed on this computer')
    if (!hasGraphicalSession()) throw new Error('this computer has no graphical session for a browser window')
    mkdirSync(this.profile, { recursive: true })
    const portFile = join(this.profile, 'DevToolsActivePort')
    rmSync(portFile, { force: true })
    this.child = spawn(binary, [
      `--user-data-dir=${this.profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      // DevTools control must not mark the page as automated (navigator.webdriver), as in the container image.
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore', detached: false })
    this.child.on('exit', () => { this.endpoint = undefined })
    for (let waited = 0; waited < 20_000; waited += 200) {
      if (existsSync(portFile)) {
        const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
        if (port !== undefined && path !== undefined) {
          this.endpoint = `ws://127.0.0.1:${port}${path}`
          return this.endpoint
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('Chrome did not open its DevTools within 20 seconds')
  }
}
