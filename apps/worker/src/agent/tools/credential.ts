import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RobotHost } from '../host.ts'
import { tool } from './define.ts'

interface CredentialInput {
  kind: 'login' | 'secret'
  service: string
  why: string
  websites?: string[]
  scope?: string
}

/**
 * Asking for a credential (v1.15 ticket 05, gb-3192): the Ask carries the Login entry form, pre-filled with what the Robot gave. Saving it
 * creates the entry under the owner, grants it to the Robot at allow and wakes the Robot with the entry's name. The password goes from the
 * owner's browser to the Home; this tool, its program and the Robot never see it (gb-196l).
 */
export function credentialTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<CredentialInput>({
      name: 'request_credential',
      description: "Ask your owner for a login or a secret you need and do not have. Say which service, why you need it and, for a login, the websites it is for and what you will use it for. Your owner fills in the form in the Conversation; saving it grants the entry to you and wakes you with its name. The password never reaches you: use a login with login_fill, a secret with secret_get. If they decline, do not ask again. The call returns at once; end your Turn with one short line.",
      parameters: {
        properties: {
          kind: { type: 'string', enum: ['login', 'secret'], description: 'login: a username and password for a website; secret: a value such as an API key' },
          service: { type: 'string', description: 'The service it is for, for example "mBank" or "OpenAI API"' },
          why: { type: 'string', description: 'Why you need it, in your owner\'s language' },
          websites: { type: 'array', items: { type: 'string' }, description: 'A login: the websites it is for (addresses or domains)' },
          scope: { type: 'string', description: 'A login: what you will do with it, for example "read statements, never pay"' },
        },
        required: ['kind', 'service', 'why'],
      },
      execute: async ({ kind, service, why, websites, scope }) => {
        if (kind !== 'login' && kind !== 'secret') throw new Error('request_credential: kind is login or secret.')
        for (const [name, value] of Object.entries({ service, why })) if (value.trim() === '') throw new Error(`request_credential: parameter "${name}" is required and must not be empty.`)
        const credential = { credential: kind, service: service.trim(), why: why.trim(), websites: (websites ?? []).map((site) => site.trim()).filter((site) => site !== ''), scope: scope?.trim() || null }
        const asked = host.propose('credential', `${credential.service}: ${credential.credential}`, { credential })
        return { askId: asked.id, status: 'waiting', note: 'Your owner sees the request now. End your Turn with one short line; you will be woken with the entry name, or with their refusal.' }
      },
    }),
  ]
}
