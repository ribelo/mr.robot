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
  onChange: (listener: (state: unknown) => void) => ipcRenderer.on('changed', (_event, state) => listener(state)),
})
