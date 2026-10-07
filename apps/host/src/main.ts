/**
 * The Mr. Robot desktop app (v1.2 ticket 01, hs-vtg3): pairs this computer to a Member, keeps one
 * outbound connection, sits in the tray with its status and starts at login.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { HostChrome } from './chrome.ts'
import { ConfigFile, normalizeServer, type HostConfig } from './config.ts'
import { HostLink, startPairing, waitForApproval, type LinkState } from './connection.ts'

const VERSION = '0.1.0'
// A small green robot dot for the tray (16x16 PNG).
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR4nGNgoBZgZGRk+M/AwMDAxMTEwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBQAQC5xQMRrW1ZcgAAAABJRU5ErkJggg=='

if (!app.requestSingleInstanceLock()) app.quit()

const configFile = ConfigFile.in(join(app.getPath('userData')))
let config: HostConfig = configFile.read(hostname())
const chrome = new HostChrome(join(app.getPath('userData'), 'chrome-profile'))
let link: HostLink | undefined
let state: LinkState = 'unpaired'
let detail: string | undefined
let pairing: { code: string; approveUrl: string } | undefined
let pairingCancelled = false
let sessions = 0
let tray: Tray | undefined
let window: BrowserWindow | undefined

function snapshot() {
  return { ...config, token: undefined, state, detail, code: pairing?.code, approveUrl: pairing?.approveUrl, sessions }
}

function changed(): void {
  window?.webContents.send('changed', snapshot())
  if (tray !== undefined) {
    tray.setToolTip(`Mr. Robot · ${config.name} · ${state}${sessions > 0 ? ` · ${sessions} robot session(s)` : ''}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `${config.name}: ${state}`, enabled: false },
      ...(sessions > 0 ? [{ label: `${sessions} robot browser session(s)`, enabled: false }] : []),
      { type: 'separator' },
      { label: 'Open Mr. Robot', enabled: config.server !== null, click: () => { if (config.server !== null) void shell.openExternal(config.server) } },
      { label: 'Settings…', click: () => openWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { link?.stop(); app.quit() } },
    ]))
  }
}

function setState(next: LinkState, why?: string): void {
  state = next
  detail = why
  changed()
}

function openWindow(): void {
  if (window !== undefined && !window.isDestroyed()) {
    window.show()
    window.focus()
    return
  }
  window = new BrowserWindow({ width: 520, height: 520, title: 'Mr. Robot host', autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true } })
  void window.loadFile(join(__dirname, 'window.html'))
}

function connect(): void {
  link?.stop()
  link = undefined
  if (config.server === null || config.hostId === null || config.token === null) {
    setState('unpaired')
    return
  }
  link = new HostLink({ server: config.server, hostId: config.hostId, token: config.token, version: VERSION }, chrome, {
    state: setState,
    paired: () => undefined,
    unpaired: () => {
      config = { ...config, hostId: null, token: null }
      configFile.write(config)
      link = undefined
      setState('unpaired', 'This computer was unpaired.')
    },
    sessions: (count) => { sessions = count; changed() },
  })
  link.start()
}

/** Start at login (hs-5slg): a login item on macOS, an XDG autostart entry on Linux. */
function applyAutostart(enabled: boolean): void {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return
  }
  const file = join(homedir(), '.config', 'autostart', 'mr-robot-host.desktop')
  if (!enabled) {
    rmSync(file, { force: true })
    return
  }
  // MR_ROBOT_HOST_EXEC is set by the Nix wrapper; from source, Electron and this app's path.
  const exec = process.env.MR_ROBOT_HOST_EXEC ?? `${process.execPath} ${join(__dirname, 'main.cjs')}`
  mkdirSync(join(homedir(), '.config', 'autostart'), { recursive: true })
  writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Mr. Robot host\nExec=${exec} --hidden\nX-GNOME-Autostart-enabled=true\n`)
}

ipcMain.handle('state', () => snapshot())

ipcMain.handle('save', (_event, server: string, name: string, autostart: boolean) => {
  let address: string
  try {
    address = normalizeServer(server)
  } catch {
    return { error: 'That is not a server address.' }
  }
  if (name.trim() === '') return { error: 'Give this computer a name.' }
  // A different server means a new pairing (hs-0cr2).
  const moved = config.server !== null && config.server !== address
  config = { ...config, server: address, name: name.trim(), autostart, ...(moved ? { hostId: null, token: null } : {}) }
  configFile.write(config)
  applyAutostart(autostart)
  if (moved) connect()
  changed()
  return { ok: true }
})

ipcMain.handle('pair', async () => {
  if (config.server === null) return { error: 'Enter the server address first.' }
  if (config.hostId !== null) {
    connect()
    return { ok: true }
  }
  pairingCancelled = false
  try {
    pairing = await startPairing(config.server, config.name)
    setState('pairing')
    await shell.openExternal(pairing.approveUrl)
    const paired = await waitForApproval(config.server, pairing.code, () => pairingCancelled)
    config = { ...config, hostId: paired.hostId, token: paired.token }
    configFile.write(config)
    pairing = undefined
    connect()
    return { ok: true }
  } catch (error) {
    pairing = undefined
    setState('unpaired', error instanceof Error ? error.message : String(error))
    return { error: detail }
  }
})

ipcMain.handle('unpair', async () => {
  pairingCancelled = true
  link?.stop()
  link = undefined
  config = { ...config, hostId: null, token: null }
  configFile.write(config)
  setState('unpaired', 'Unpaired here; remove it from your profile in Mr. Robot as well if it is still listed.')
  return { ok: true }
})

app.on('window-all-closed', () => { /* stay in the tray */ })

void app.whenReady().then(() => {
  app.dock?.hide()
  tray = new Tray(nativeImage.createFromDataURL(ICON))
  tray.on('click', () => openWindow())
  if (config.autostart) applyAutostart(true)
  connect()
  changed()
  // First start, or not paired yet: the window asks for the server address (hs-ntbd).
  if (config.server === null || config.hostId === null || !process.argv.includes('--hidden')) openWindow()
})
