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
      parameters: { properties: { purpose: { type: 'string', description: 'Why you need this, in one or two sentences' }, ...grantSchema }, required: ['purpose'] },
      execute: async ({ purpose, ...grants }) => {
        const proposal = host.propose('grants', purpose, { grants: grantSet(grants) })
        return { proposalId: proposal.id, status: 'waiting for your owner', grants: proposal.grants }
      },
    }),
  ]
}

interface ReviewInput { title: string; items: Array<{ id: string; title: string; body: string; action?: string }> }

/** The most items one review may hold. */
export const REVIEW_MAX_ITEMS = 200
/** The largest body of one review item, in bytes (UTF-8). */
export const REVIEW_MAX_BODY_BYTES = 8 * 1024

/** Many decisions in one Ask (cd-dt2x): the owner approves all, some or none of the items. */
export function reviewTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<ReviewInput>({
      name: 'propose_review',
      description: 'Put a list of items to your owner for approval in one Ask, e.g. drafted messages to send. Each item has a unique id, a title, a body (what the owner reads, at most 8 KB) and optionally an action label (what approving does). At most 200 items per review. The owner approves all, some or none; you are woken with the approved and rejected ids and act on exactly those.',
      parameters: {
        properties: {
          title: { type: 'string', description: 'What is being reviewed' },
          items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, action: { type: 'string' } }, required: ['id', 'title', 'body'] } },
        },
        required: ['title', 'items'],
      },
      execute: async ({ title, items }) => {
        if (title.trim() === '') throw new Error('A review needs a title')
        if (items.length === 0) throw new Error('A review needs at least one item')
        if (items.length > REVIEW_MAX_ITEMS) throw new Error(`A review holds at most ${REVIEW_MAX_ITEMS} items; this one has ${items.length}. Split it into several reviews.`)
        const encoder = new TextEncoder()
        const large = items.find((item) => encoder.encode(item.body).byteLength > REVIEW_MAX_BODY_BYTES)
        if (large !== undefined) throw new Error(`A review item body is at most ${REVIEW_MAX_BODY_BYTES / 1024} KB; item "${large.id}" is larger. Shorten it or put the full text in a Workspace file and name the file.`)
        const ids = items.map((item) => item.id)
        const repeated = ids.find((id, index) => id.trim() === '' || ids.indexOf(id) !== index)
        if (repeated !== undefined) throw new Error(`Review item ids must be non-empty and unique; check "${repeated}"`)
        const proposal = host.propose('review', title, { review: { title, items: items.map(({ id, title: itemTitle, body, action }) => ({ id, title: itemTitle, body, ...(action === undefined || action.trim() === '' ? {} : { action }) })) } })
        return { proposalId: proposal.id, status: 'waiting for your owner; you are woken with the approved and rejected ids', items: items.length }
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
