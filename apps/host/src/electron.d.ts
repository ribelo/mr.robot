// The parts of Electron the app uses (the runtime comes from nixpkgs / the .app bundle, not npm).
declare module 'electron' {
  export const app: {
    whenReady(): Promise<void>
    on(event: string, listener: (...args: unknown[]) => void): void
    quit(): void
    getPath(name: 'userData' | 'home' | 'appData'): string
    setPath(name: 'userData', path: string): void
    setName(name: string): void
    getVersion(): string
    requestSingleInstanceLock(): boolean
    setLoginItemSettings(settings: { openAtLogin: boolean; path?: string; args?: string[] }): void
    /** True in an installed app, false when run from source with the electron program. */
    readonly isPackaged: boolean
    getLoginItemSettings(): { openAtLogin: boolean }
    dock?: { hide(): void }
    setBadgeCount(count: number): boolean
  }
  export class Notification {
    constructor(options: { title: string; body: string; silent?: boolean })
    static isSupported(): boolean
    show(): void
    on(event: 'click', listener: () => void): void
  }
  export class BrowserWindow {
    constructor(options: Record<string, unknown>)
    loadFile(path: string): Promise<void>
    loadURL(url: string): Promise<void>
    show(): void
    focus(): void
    close(): void
    isDestroyed(): boolean
    on(event: string, listener: (...args: unknown[]) => void): void
    webContents: {
      send(channel: string, ...args: unknown[]): void
      getURL(): string
      executeJavaScript(code: string): Promise<unknown>
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
      on(event: string, listener: (...args: unknown[]) => void): void
    }
  }
  /** A browser session; one made from a partition name without "persist:" lives in memory only. */
  export interface Session {
    cookies: { get(filter: { name?: string; url?: string }): Promise<Array<{ name: string; value: string; domain?: string }>> }
    webRequest: {
      onBeforeSendHeaders(
        filter: { urls: string[] } | null,
        listener?: ((details: { requestHeaders: Record<string, string> }, callback: (response: { requestHeaders: Record<string, string> }) => void) => void) | null,
      ): void
    }
    clearStorageData(): Promise<void>
    clearCache(): Promise<void>
    clearAuthCache(): Promise<void>
    setPermissionRequestHandler(handler: ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null): void
    getUserAgent(): string
    setUserAgent(userAgent: string): void
  }
  export const session: { fromPartition(partition: string): Session }
  export class Tray {
    constructor(image: unknown)
    setToolTip(text: string): void
    setContextMenu(menu: unknown): void
    setImage(image: unknown): void
    setTitle(title: string): void
    on(event: string, listener: () => void): void
  }
  export const Menu: { buildFromTemplate(template: Array<Record<string, unknown>>): unknown }
  export const nativeImage: { createFromDataURL(url: string): unknown }
  export const shell: { openExternal(url: string): Promise<void> }
  export const ipcMain: { handle(channel: string, listener: (event: { senderFrame?: { url: string } | null }, ...args: never[]) => unknown): void }
  export const ipcRenderer: { invoke(channel: string, ...args: unknown[]): Promise<unknown>; on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void }
  export const contextBridge: { exposeInMainWorld(key: string, api: unknown): void }
}
