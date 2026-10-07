import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface SecretHost {
  /** The value of a granted entry marked "allow reading", or an error naming what is granted. */
  secret(name: string): Promise<string>
  /** Granted login entries, and whether each belongs to the page open now (rb-vpes). */
  logins(): Promise<Array<{ name: string; username: string; websites: readonly string[]; matchesPage: boolean; readable: boolean }>>
  /** Type a granted entry into the current page; the password never reaches the caller (rb-e1ic, rb-1dzv). */
  fillLogin(name: string): Promise<string>
}

/** Logins (v1.1 ticket 05): list and fill granted entries; read raw values only where allowed. */
export function secretTools(host: SecretHost, granted: readonly string[]): ToolDefinition[] {
  return [
    tool<Record<string, never>>({
      name: 'login_list',
      description: `List the login entries granted to you (${granted.length === 0 ? 'none yet' : granted.join(', ')}): name, username, websites, and whether each belongs to the page open in your browser. Passwords are never shown.`,
      parameters: { properties: {} },
      execute: async () => host.logins(),
    }),
    tool<{ name: string }>({
      name: 'login_fill',
      description: 'Fill a granted login entry into the username and password fields of the page open in your browser. The platform types it; you never see the password. Refused when the page is not on one of the entry\'s websites. Submit the form yourself afterwards.',
      parameters: { properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }) => host.fillLogin(name),
    }),
    tool<{ name: string }>({
      name: 'secret_get',
      description: 'Read the raw value of a granted entry marked "allow reading" (API keys and the like). For website logins use login_fill instead. Never repeat a value in your replies, notes or messages.',
      parameters: { properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async ({ name }) => host.secret(name),
    }),
  ]
}

/** Replace every occurrence of a secret value, raw or JSON-escaped, with a visible mask (robot-4zi6). */
export function maskSecrets(text: string, secrets: ReadonlyArray<readonly [string, string]>): string {
  let masked = text
  for (const [name, value] of secrets) {
    if (value.length < 3) continue
    const escaped = JSON.stringify(value).slice(1, -1)
    for (const form of new Set([value, escaped])) masked = masked.split(form).join(`[secret:${name}]`)
  }
  return masked
}
