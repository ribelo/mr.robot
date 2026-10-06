import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface SecretHost {
  /** The value of a granted secret, or an error naming what is granted. */
  secret(name: string): Promise<string>
}

/** secret.get (robot-0bde): only names granted to this Robot resolve. */
export function secretTools(host: SecretHost, granted: readonly string[]): ToolDefinition[] {
  return [
    tool<{ name: string }>({
      name: 'secret_get',
      description: `Read the value of a secret granted to you (${granted.length === 0 ? 'none yet' : granted.join(', ')}). Use it directly in the next tool call, for example to type a password into a login form. Never repeat a secret value in your replies, notes or messages.`,
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
