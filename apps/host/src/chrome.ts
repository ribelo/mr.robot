/**
 * The host browser (hs-zmbc): the installed Chrome or Chromium, started with its own "Mr. Robot"
 * profile and a visible window, DevTools on localhost only. It stays open between tasks.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const CANDIDATES: Record<string, string[]> = {
  linux: ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
}

/** The Chrome this host would use, or null. */
export function findChrome(): string | null {
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (candidate.startsWith('/')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    for (const directory of (process.env.PATH ?? '').split(':')) {
      if (directory !== '' && existsSync(join(directory, candidate))) return join(directory, candidate)
    }
  }
  return null
}

/** A graphical session the browser can open a window in. */
export function hasGraphicalSession(): boolean {
  return process.platform === 'darwin' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
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
