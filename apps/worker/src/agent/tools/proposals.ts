import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { isGrantLevel, type GrantField, type GrantLevel, type GrantLevels, type GrantSet } from '@mr-robot/protocol'
import { TOOL_GROUPS, TOOL_GROUP_NAMES, isToolGroup, setupGrants } from '../catalog.ts'
import type { RobotHost } from '../host.ts'
import { tool } from './define.ts'

/** Levels a Robot may ask for itself (sk-8e0f); lowering an item is its owner's, in settings. */
export const PROPOSABLE_LEVELS: readonly GrantLevel[] = ['allow', 'ask']

/** The grant parameters of a proposal tool: a list per kind, each item a name (at allow) or { name, level }. */
export function grantParameters(levels: readonly GrantLevel[], logins: 'secrets' | 'logins' = 'secrets'): Record<string, unknown> {
  const list = (description: string, name: Record<string, unknown> = { type: 'string' }) => ({
    type: 'array',
    items: {
      oneOf: [
        name,
        { type: 'object', additionalProperties: false, properties: { name: { ...name, description: 'The item' }, level: { type: 'string', enum: levels, description: `${levels.join(', ')}; allow when left out` } }, required: ['name'] },
      ],
    },
    description: `${description}. Each item is a name (at allow) or { name, level }.`,
  })
  return {
    tools: list('Tool groups', { type: 'string', enum: TOOL_GROUP_NAMES }),
    skills: list('Skill names from the Home library'),
    recipients: list('Robot ids to message'),
    [logins]: list('Login entry names (see login_list)'),
    hosts: list('Host facets: "<hostId>:browser", "<hostId>:files" or "<hostId>:shell"'),
    connections: list('Connection ids; "<connectionId>:write" also sends (Gmail send, Slack post)'),
  }
}

/**
 * The grant items of a proposal tool's arguments (sk-8e0f, sk-iq3n): each item a name at allow or
 * { name, level } with one of `levels`. Unknown tool groups, levels and shapes are refused.
 */
export function proposedGrants(input: Partial<Record<GrantField, unknown>>, levels: readonly GrantLevel[]): GrantSet {
  const parse = (field: GrantField): GrantLevels => {
    const value = input[field]
    if (value === undefined || value === null) return {}
    if (!Array.isArray(value)) throw new Error(`${field} must be a list`)
    const entries = value.map((item: unknown): [string, GrantLevel] => {
      if (typeof item === 'string') return [item, 'allow']
      const { name, level } = (item ?? {}) as { name?: unknown; level?: unknown }
      if (typeof name !== 'string') throw new Error(`${field}: each item is a name or { name, level }`)
      if (level === undefined) return [name, 'allow']
      if (isGrantLevel(level) && levels.includes(level)) return [name, level]
      throw new Error(`${field}: the level of "${name}" must be ${levels.join(' or ')}`)
    })
    return Object.fromEntries(entries)
  }
  const grants: GrantSet = { tools: parse('tools'), skills: parse('skills'), recipients: parse('recipients'), secrets: parse('secrets'), hosts: parse('hosts'), connections: parse('connections') }
  const unknown = Object.keys(grants.tools).filter((name) => !isToolGroup(name))
  if (unknown.length > 0) throw new Error(`Unknown tool groups: ${unknown.join(', ')}. Known: ${TOOL_GROUP_NAMES.join(', ')}`)
  return grants
}

const catalogText = Object.entries(TOOL_GROUPS).map(([name, text]) => `- ${name}: ${text}`).join('\n')

/** Asking for more reach (robot-vy9z): the owner answers a stored proposal. */
export function grantProposalTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ purpose: string } & Partial<Record<GrantField, unknown>>>({
      name: 'propose_grants',
      description: `Ask your owner to change your Grants for good. Name exactly what you need and why; they approve or reject the stored list. Each item gets a level: allow (you use it freely) or ask (each call waits for your owner's answer); allow when you name no level. Tool groups:\n${catalogText}`,
      parameters: { properties: { purpose: { type: 'string', description: 'Why you need this, in one or two sentences' }, ...grantParameters(PROPOSABLE_LEVELS) }, required: ['purpose'] },
      execute: async ({ purpose, ...grants }) => {
        const proposal = host.propose('grants', purpose, { grants: proposedGrants(grants, PROPOSABLE_LEVELS) })
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
          items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, action: { type: 'string' } }, required: ['id', 'title', 'body'] }, description: 'The items to approve or reject, at most 200; each a unique id, a title, a body and an optional action label' },
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

interface IdentityInput { name?: string; title?: string; description?: string; avatar_color?: string }

const AVATAR_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Who the Robot is (robot-btct; v1.15 ticket 11, gb-vipe, gb-4563). During setup it sets all of it. After setup it may
 * change its title, description and avatar colour as it grows into its job; its name stays its owner's to change in the
 * Robot's settings, so the sidebar never changes under them. The Robot tells its owner what changed.
 */
export function identityTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<IdentityInput>({
      name: 'set_identity',
      description: 'Set your title, one-paragraph description and avatar colour (#rrggbb). During setup also your short name, as soon as your owner has said what you are for. After setup your name is your owner\'s to change in your settings. Tell your owner what you changed.',
      parameters: {
        properties: {
          name: { type: 'string', description: 'Your short name; accepted during setup only' },
          title: { type: 'string', description: 'Your title, for example "Housing"' },
          description: { type: 'string', description: 'One paragraph on what you are for' },
          avatar_color: { type: 'string', description: 'A colour as #rrggbb' },
        },
      },
      execute: async ({ name, title, description, avatar_color }) => {
        if (name !== undefined && host.config().status !== 'setup') throw new Error('set_identity: your name is your owner\'s to change, in your settings. Change your title, description or avatar_color, and ask your owner to rename you.')
        if (avatar_color !== undefined && !AVATAR_COLOR.test(avatar_color)) throw new Error('set_identity: avatar_color must be a colour like #3b82f6.')
        const before = host.config().identity
        const identity = host.setIdentity({
          ...(name === undefined ? {} : { name }),
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
          ...(avatar_color === undefined ? {} : { avatarColor: avatar_color }),
        })
        const changed = (['name', 'title', 'description', 'avatarColor'] as const).filter((field) => identity[field] !== before[field])
        return { identity, changed }
      },
    }),
  ]
}

/** Setup (robot-btct, robot-cobv): the Robot proposes one Grant summary. */
export function setupTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ purpose: string; requires_hosts?: boolean } & Partial<Record<GrantField, unknown>>>({
      name: 'setup_complete',
      description: `Finish setup: propose the one summary of Grants you need, each at allow or ask (allow when you name no level). Approval activates you with what you proposed; files, web and exa are at ask unless you propose them, everything else stays denied. Only Grants are approved; your persona files are your own business. Tool groups:\n${catalogText}`,
      parameters: {
        properties: {
          purpose: { type: 'string', description: 'What you will do, in one or two sentences' },
          requires_hosts: { type: 'boolean', description: 'true when your owner wants you to run no Task while any Host you ask a facet on is offline (v1.16); leave out otherwise' },
          ...grantParameters(PROPOSABLE_LEVELS),
        },
        required: ['purpose'],
      },
      execute: async ({ purpose, requires_hosts, ...grants }) => {
        // The stored proposal is what approval applies, defaults included, so the owner sees it all (sk-3sij).
        const proposal = host.propose('setup', purpose, { grants: setupGrants(proposedGrants(grants, PROPOSABLE_LEVELS)), ...(requires_hosts === true ? { requiresHosts: true } : {}) })
        return { proposalId: proposal.id, status: 'waiting for your owner to approve the Grants', grants: proposal.grants, ...(proposal.requiresHosts === true ? { requiresHosts: true } : {}) }
      },
    }),
  ]
}