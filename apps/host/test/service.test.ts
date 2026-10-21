/**
 * The service Host (v1.21 ticket 09): the display check per platform (cw-ixto), and the service bundle, built as the package builds it,
 * started with plain Node (no Electron) against a Worker of the test's own: it reports no graphical session and no browser, serves a call,
 * and on SIGTERM tells the Worker it stops (HOST_STOPPING) and exits (cw-bi6y, cw-y7wy, cw-dr33).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { HOST_STOPPING, makeHostClient, parseFrame } from '@mr-robot/host-protocol'
import { hasDisplay } from '../src/chrome.ts'
import { defaultConfigDirectory } from '../src/config.ts'
import { parseArguments } from '../src/service.ts'

const APP = join(__dirname, '..')

describe('the display check (cw-ixto)', () => {
  it('asks for a display on every platform, not for the OS', () => {
    expect(hasDisplay('linux', {})).toBe(false)
    expect(hasDisplay('linux', { DISPLAY: ':0' })).toBe(true)
    expect(hasDisplay('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
    expect(hasDisplay('darwin', {}, () => 'Aqua')).toBe(true)
    expect(hasDisplay('darwin', {}, () => 'Background')).toBe(false)
    expect(hasDisplay('darwin', {}, () => 'System')).toBe(false)
    expect(hasDisplay('win32', { SESSIONNAME: 'Console' })).toBe(true)
    expect(hasDisplay('win32', {})).toBe(false)
  })

  it('reads the arguments and finds the desktop app\'s config directory', () => {
    expect(parseArguments(['pair', 'robots.example.com', '--name', 'NAS'])).toEqual({ kind: 'pair', server: 'robots.example.com', name: 'NAS' })
    expect(parseArguments(['--service'])).toEqual({ kind: 'serve' })
    expect(parseArguments(['pair'])).toMatchObject({ kind: 'usage' })
    expect(defaultConfigDirectory('linux', { XDG_CONFIG_HOME: '/x' }, '/home/a')).toBe('/x/mr-robot-host')
    expect(defaultConfigDirectory('linux', {}, '/home/a')).toBe('/home/a/.config/mr-robot-host')
    expect(defaultConfigDirectory('darwin', {}, '/Users/a')).toBe('/Users/a/Library/Application Support/mr-robot-host')
  })
})

describe('the service entry (cw-bi6y, cw-y7wy, cw-dr33)', () => {
  let home = ''
  let worker: WebSocketServer
  let socket: WebSocket | undefined
  const frames: string[] = []
  let closed: number | undefined
  let child: ChildProcess

  beforeAll(async () => {
    await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: APP })
    home = await mkdtemp(join(homedir(), '.mr-robot-host-service-'))
    worker = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    worker.on('connection', (connection) => {
      socket = connection
      connection.on('message', (data) => frames.push(data.toString()))
      connection.on('close', (code) => { closed = code })
    })
    await new Promise((resolve) => worker.once('listening', resolve))
    const config = join(home, 'config')
    await mkdir(config, { recursive: true })
    await writeFile(join(config, 'host.json'), JSON.stringify({ server: `http://127.0.0.1:${(worker.address() as AddressInfo).port}`, name: 'Box', hostId: 'h-service', token: 't', autostart: false }))
    // A service has no display, whatever its parent has.
    const { DISPLAY: _display, WAYLAND_DISPLAY: _wayland, ...env } = process.env
    child = spawn(process.execPath, [join(APP, 'dist', 'service.cjs'), '--service'], { env: { ...env, HOME: home, MR_ROBOT_HOST_CONFIG: config }, stdio: 'pipe' })
  }, 180_000)
  afterAll(async () => {
    child.kill('SIGKILL')
    await new Promise((resolve) => worker.close(resolve))
    await rm(home, { recursive: true, force: true })
  })

  it('is one bundle without Electron', () => {
    const bundle = readFileSync(join(APP, 'dist', 'service.cjs'), 'utf8')
    expect(bundle).not.toMatch(/require\(["']electron["']\)/)
  })

  it('connects, reports no graphical session and no browser, serves a call, and stops with a notice on SIGTERM', async () => {
    await vi.waitFor(() => expect(frames.some((text) => parseFrame(text)?.t === 'hb')).toBe(true), { timeout: 60_000, interval: 200 })
    const beat = frames.map(parseFrame).find((parsed) => parsed?.t === 'hb')
    expect(beat?.t === 'hb' && beat.d.capabilities).toMatchObject({ graphical: false, chrome: null, shell: 'bash' })
    // A call through the protocol, as the Worker makes it.
    const side = makeHostClient((text) => socket!.send(text))
    socket!.on('message', (data) => { const parsed = parseFrame(data.toString()); if (parsed?.t === 'rpc') Effect.runFork(side.deliver(parsed.d)) })
    const listing = await Effect.runPromise(Effect.scoped(Effect.flatMap(side.client, (client) => client.ListDirectory({ path: '~', access: { robot: 'bot', mode: 'read-only', roots: [] } }))))
    expect(listing.directories).toContain('config')
    const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)))
    child.kill('SIGTERM')
    expect(await exited).toBe(0)
    await vi.waitFor(() => expect(closed).toBe(HOST_STOPPING))
  }, 90_000)
})
