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

// Settings live in ~/.config/mr-robot-host (Linux) or ~/Library/Application Support/mr-robot-host (macOS).
app.setName('Mr. Robot host')
app.setPath('userData', join(app.getPath('appData'), 'mr-robot-host'))
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
      { label: 'Open Mr. Robot', click: () => openWindow() },
      { label: 'This computer…', enabled: config.server !== null, click: () => openWindow('#/this-computer') },
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

/** The app window is Mr. Robot (hs-pyn0): the server's interface, or the address prompt on first start. */
function openWindow(path = ''): void {
  if (window === undefined || window.isDestroyed()) {
    window = new BrowserWindow({ width: 1280, height: 860, title: 'Mr. Robot', autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true } })
    // Links to other sites open in the browser, not in the app window.
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  if (config.server === null) void window.loadFile(join(__dirname, 'window.html'))
  else void window.loadURL(`${config.server}/${path}`)
  window.show()
  window.focus()
}

/** The bridge answers only pages of the configured server, or the local address prompt. */
function trusted(event: { senderFrame?: { url: string } | null }): boolean {
  const url = event.senderFrame?.url ?? ''
  return url.startsWith('file://') || (config.server !== null && url.startsWith(`${config.server}/`))
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

ipcMain.handle('state', (event) => (trusted(event) ? snapshot() : null))

ipcMain.handle('save', (event, change: { server?: string; name?: string; autostart?: boolean }) => {
  if (!trusted(event)) return { error: 'not allowed' }
  let server = config.server
  if (change.server !== undefined) {
    try {
      server = normalizeServer(change.server)
    } catch {
      return { error: 'That is not a server address.' }
    }
  }
  if (change.name !== undefined && change.name.trim() === '') return { error: 'Give this computer a name.' }
  // A different server means a new pairing there (hs-0cr2).
  const moved = server !== config.server
  config = { ...config, server, ...(change.name === undefined ? {} : { name: change.name.trim() }), ...(change.autostart === undefined ? {} : { autostart: change.autostart }), ...(moved ? { hostId: null, token: null } : {}) }
  configFile.write(config)
  if (change.autostart !== undefined) applyAutostart(change.autostart)
  if (moved) {
    connect()
    openWindow(config.hostId === null ? '#/this-computer' : '')
  }
  changed()
  return { ok: true }
})

ipcMain.handle('pair', async (event) => {
  if (!trusted(event)) return { error: 'not allowed' }
  if (config.server === null) return { error: 'Enter the server address first.' }
  if (config.hostId !== null) {
    connect()
    return { ok: true }
  }
  pairingCancelled = false
  try {
    pairing = await startPairing(config.server, config.name)
    setState('pairing')
    const code = pairing.code
    // The signed-in page approves the code (hs-upeq); the token comes back here, never to the page.
    void waitForApproval(config.server, code, () => pairingCancelled).then((paired) => {
      config = { ...config, hostId: paired.hostId, token: paired.token }
      configFile.write(config)
      pairing = undefined
      connect()
    }).catch((error: unknown) => {
      pairing = undefined
      setState('unpaired', error instanceof Error ? error.message : String(error))
    })
    return { ok: true, code }
  } catch (error) {
    pairing = undefined
    setState('unpaired', error instanceof Error ? error.message : String(error))
    return { error: detail }
  }
})

ipcMain.handle('unpair', async (event) => {
  if (!trusted(event)) return { error: 'not allowed' }
  pairingCancelled = true
  link?.stop()
  link = undefined
  config = { ...config, hostId: null, token: null }
  configFile.write(config)
  setState('unpaired', 'Unpaired.')
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
  // At login it starts in the tray; otherwise (and on first start) the window opens.
  if (config.server === null || !process.argv.includes('--hidden')) openWindow()
})
