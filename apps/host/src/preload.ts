import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('host', {
  state: () => ipcRenderer.invoke('state'),
  save: (server: string, name: string, autostart: boolean) => ipcRenderer.invoke('save', server, name, autostart),
  pair: () => ipcRenderer.invoke('pair'),
  unpair: () => ipcRenderer.invoke('unpair'),
  onChange: (listener: (state: unknown) => void) => ipcRenderer.on('changed', (_event, state) => listener(state)),
})
