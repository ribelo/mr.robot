/** The app's settings file: server address, host name, and the host token once paired. */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface HostConfig {
  /** The Mr. Robot deployment; there is no built-in default (hs-ntbd). */
  server: string | null
  name: string
  hostId: string | null
  token: string | null
  autostart: boolean
}

export class ConfigFile {
  constructor(private readonly path: string) {}

  static in(directory: string): ConfigFile {
    return new ConfigFile(join(directory, 'host.json'))
  }

  read(defaultName: string): HostConfig {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<HostConfig>
      return { server: value.server ?? null, name: value.name ?? defaultName, hostId: value.hostId ?? null, token: value.token ?? null, autostart: value.autostart ?? true }
    } catch {
      return { server: null, name: defaultName, hostId: null, token: null, autostart: true }
    }
  }

  write(config: HostConfig): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(config, null, 2))
    // The host token is a credential: readable by this user only.
    chmodSync(this.path, 0o600)
  }
}

/** A server address as typed: https assumed, trailing slashes dropped. */
export function normalizeServer(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
  return url.origin
}
