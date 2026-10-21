/** The app's settings file: server address, host name, the host token once paired, and the commands' environment. */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_ENVIRONMENT, type EnvironmentConfig } from './environment.ts'

export interface HostConfig {
  /** The Mr. Robot deployment; there is no built-in default (hs-ntbd). */
  server: string | null
  name: string
  hostId: string | null
  token: string | null
  autostart: boolean
  /**
   * What the Robots' commands get besides the OS user's login environment (v1.21, cw-et7q, cw-dkkw): `allow` keeps names DSH's scrub
   * drops (SSH_AUTH_SOCK and GIT_* by default), `set` adds values (SSH_AUTH_SOCK of an agent a service Host should use). Edited in the
   * file by hand; the app never writes secrets here.
   */
  environment: EnvironmentConfig
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : undefined

const stringRecord = (value: unknown): Record<string, string> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string') ? (value as Record<string, string>) : undefined

/** The environment section as the file has it; what is missing or not of the right shape is the default. */
export function parseEnvironmentConfig(value: unknown): EnvironmentConfig {
  const section = typeof value === 'object' && value !== null ? (value as { allow?: unknown; set?: unknown }) : {}
  return { allow: strings(section.allow) ?? DEFAULT_ENVIRONMENT.allow, set: stringRecord(section.set) ?? DEFAULT_ENVIRONMENT.set }
}

export class ConfigFile {
  constructor(private readonly path: string) {}

  static in(directory: string): ConfigFile {
    return new ConfigFile(join(directory, 'host.json'))
  }

  read(defaultName: string): HostConfig {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<HostConfig>
      return { server: value.server ?? null, name: value.name ?? defaultName, hostId: value.hostId ?? null, token: value.token ?? null, autostart: value.autostart ?? true, environment: parseEnvironmentConfig(value.environment) }
    } catch {
      return { server: null, name: defaultName, hostId: null, token: null, autostart: true, environment: DEFAULT_ENVIRONMENT }
    }
  }

  write(config: HostConfig): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(config, null, 2))
    // The host token is a credential: readable by this user only.
    chmodSync(this.path, 0o600)
  }
}

/**
 * Where the app keeps host.json when Electron does not say (the service entry, v1.21 ticket 09): the same directory as the desktop app,
 * so that one pairing serves both. MR_ROBOT_HOST_CONFIG overrides it.
 */
export function defaultConfigDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = env['HOME'] ?? env['USERPROFILE'] ?? '.'): string {
  if (env['MR_ROBOT_HOST_CONFIG']) return env['MR_ROBOT_HOST_CONFIG']
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'mr-robot-host')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'mr-robot-host')
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'mr-robot-host')
}

/** A server address as typed: https assumed, trailing slashes dropped. */
export function normalizeServer(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
  return url.origin
}
