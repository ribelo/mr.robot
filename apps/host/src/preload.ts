/**
 * The bridge between the Mr. Robot interface and this app (v1.2 ticket 08): the web page's
 * "This computer" page reads and changes the host settings through it. Only pages of the configured
 * server get it (checked again in the main process).
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mrRobotHost', {
  state: () => ipcRenderer.invoke('state'),
  save: (change: { server?: string; name?: string; autostart?: boolean }) => ipcRenderer.invoke('save', change),
  /** Start pairing; the signed-in page approves the returned code, the app picks up its token. */
  pair: () => ipcRenderer.invoke('pair'),
  unpair: () => ipcRenderer.invoke('unpair'),
  /** The number of robots with unread messages, for the tray badge. */
  setUnread: (count: number) => ipcRenderer.invoke('unread', count),
  /**
   * Open a sign-in window for 'slack' or 'discord-user' in an isolated session and resolve with the
   * session values (the same fields the paste form asks for), { timedOut: true } after ten minutes,
   * { cancelled: true } when the window is closed, or { error }. Older apps lack this command.
   */
  connectThroughSignIn: (kind: 'slack' | 'discord-user') => ipcRenderer.invoke('connectThroughSignIn', kind),
  /** Notifications reach the app over the host channel, not Web Push. */
  nativeNotifications: true,
  onChange: (listener: (state: unknown) => void) => ipcRenderer.on('changed', (_event, state) => listener(state)),
})
