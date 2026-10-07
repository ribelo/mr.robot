import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GrantSet } from '@mr-robot/protocol'
import { TOOL_GROUPS, TOOL_GROUP_NAMES, isToolGroup } from '../catalog.ts'
import type { RobotHost } from '../host.ts'
import { tool } from './define.ts'

const grantSchema = {
  tools: { type: 'array', items: { type: 'string', enum: TOOL_GROUP_NAMES }, description: 'Tool groups' },
  skills: { type: 'array', items: { type: 'string' }, description: 'Skill names from the Home library' },
  recipients: { type: 'array', items: { type: 'string' }, description: 'Robot ids to message' },
  secrets: { type: 'array', items: { type: 'string' }, description: 'Login entry names (see login_list)' },
}

function grantSet(input: Partial<Record<keyof GrantSet, unknown>>): GrantSet {
  const list = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(String))] : []
  const tools = list(input.tools)
  const unknown = tools.filter((name) => !isToolGroup(name))
  if (unknown.length > 0) throw new Error(`Unknown tool groups: ${unknown.join(', ')}. Known: ${TOOL_GROUP_NAMES.join(', ')}`)
  return { tools, skills: list(input.skills), recipients: list(input.recipients), secrets: list(input.secrets) }
}

const catalogText = Object.entries(TOOL_GROUPS).map(([name, text]) => `- ${name}: ${text}`).join('\n')

/** Asking for more reach (robot-vy9z): the owner answers a stored proposal. */
export function grantProposalTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ purpose: string } & Partial<Record<keyof GrantSet, unknown>>>({
      name: 'propose_grants',
      description: `Ask your owner for additional Grants. Name exactly what you need and why; they approve or reject the stored list. Tool groups:\n${catalogText}`,
      parameters: { properties: { purpose: { type: 'string' }, ...grantSchema }, required: ['purpose'] },
      execute: async ({ purpose, ...grants }) => {
        const proposal = host.propose('grants', purpose, { grants: grantSet(grants) })
        return { proposalId: proposal.id, status: 'waiting for your owner', grants: proposal.grants }
      },
    }),
  ]
}

/** Setup (robot-btct, robot-cobv): the Robot defines itself, then proposes one Grant summary. */
export function setupTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ name?: string; title?: string; description?: string; avatarColor?: string }>({
      name: 'set_identity',
      description: 'Set your name, optional title, one-paragraph description and avatar colour (#rrggbb). Use it as soon as the owner has said what you are for.',
      parameters: {
        properties: { name: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, avatarColor: { type: 'string' } },
      },
      execute: async (input) => ({ identity: host.setIdentity(input) }),
    }),
    tool<{ purpose: string } & Partial<Record<keyof GrantSet, unknown>>>({
      name: 'setup_complete',
      description: `Finish setup: propose the one summary of Grants you need. Only Grants are approved; your persona files are your own business. Approval activates you. Tool groups:\n${catalogText}`,
      parameters: { properties: { purpose: { type: 'string', description: 'What you will do, in one or two sentences' }, ...grantSchema }, required: ['purpose'] },
      execute: async ({ purpose, ...grants }) => {
        const proposal = host.propose('setup', purpose, { grants: grantSet(grants) })
        return { proposalId: proposal.id, status: 'waiting for your owner to approve the Grants', grants: proposal.grants }
      },
    }),
  ]
}
