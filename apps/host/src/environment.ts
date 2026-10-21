/**
 * The environment a Robot's command gets on this computer (v1.21, cw-et7q, cw-dkkw): the OS user's login environment, captured once when
 * the app starts and again when it is paired, so that git, nix and the user's own tools work as in a terminal (an app started from a
 * desktop or by systemd has a short PATH and none of the profile). DSH starts every child from the app's own environment without its
 * credential-shaped names; the captured one is handed over as the explicit environment, which DSH merges after its scrub, so it is
 * scrubbed here the same way first. The Host config names the variables a coding Robot needs that the scrub would drop (the allow-list,
 * SSH_AUTH_SOCK and GIT_* by default) and values to set (an SSH agent's socket for a service Host).
 */
import { execFile } from 'node:child_process'
import { DSH_ENV_PREFIX, SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'

/** What the Host config says of the commands' environment. */
export interface EnvironmentConfig {
  /** Names to keep although DSH's scrub would drop them; a trailing * matches every name with that prefix. */
  readonly allow: readonly string[]
  /** Values every command gets, after everything else (an SSH agent's socket: SSH_AUTH_SOCK). */
  readonly set: Readonly<Record<string, string>>
}

/** The variables a coding Robot needs that the scrub may drop: the SSH agent and git's own settings (cw-et7q). */
export const DEFAULT_ENVIRONMENT: EnvironmentConfig = { allow: ['SSH_AUTH_SOCK', 'GIT_*'], set: {} }

/** Names that describe the shell that printed the environment, not the user: a command gets its own. */
const SHELL_STATE = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])

const allowed = (name: string, allow: readonly string[]): boolean =>
  allow.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern))

/**
 * The environment a command gets from a captured one: without the shell's own state, without the names DSH's scrub drops
 * (credential-shaped names and DSH_*) unless the allow-list keeps them, then the configured values.
 */
export function commandEnvironment(captured: Readonly<Record<string, string>>, config: EnvironmentConfig): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(captured)) {
    if (SHELL_STATE.has(name)) continue
    const scrubbed = SENSITIVE_ENV_PATTERN.test(name) || name.toUpperCase().startsWith(DSH_ENV_PREFIX)
    if (!scrubbed || allowed(name, config.allow)) env[name] = value
  }
  return { ...env, ...config.set }
}

/** NUL-separated NAME=value pairs, as `env -0` prints them. */
export function parseEnvironment(output: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of output.split('\0')) {
    const at = entry.indexOf('=')
    if (at > 0) env[entry.slice(0, at)] = entry.slice(at + 1)
  }
  return env
}

/** How long the login shell may take to print its environment. */
const CAPTURE_TIMEOUT_MS = 10_000

/**
 * The environment the OS user's login shell sets up (its profile read, as a terminal would), or undefined when it cannot be asked: on
 * Windows, where commands get the app's own environment, or when the shell fails or prints no PATH.
 */
export function captureLoginEnvironment(shell = process.env['SHELL'] || '/bin/sh'): Promise<Record<string, string> | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined)
  return new Promise((done) => {
    execFile(shell, ['-l', '-c', 'env -0'], { timeout: CAPTURE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      const env = error === null ? parseEnvironment(stdout) : {}
      done(env['PATH'] === undefined ? undefined : env)
    })
  })
}
