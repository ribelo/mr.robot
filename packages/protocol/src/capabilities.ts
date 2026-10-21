/**
 * What a Robot may do, as one list (v1.11 ticket 04, sk-e1hh, sk-ixvp): every grantable item of the
 * settings catalog with the level the Robot holds on it. Advanced settings, the my_capabilities tool and
 * the runtime section of the prompt all read this list, so the three never disagree.
 *
 * Self-contained on purpose (type imports only): index.ts re-exports it.
 */
import type { GrantLevel, GrantSet, HostView, SettingsCatalog } from './index.ts'

export type CapabilityField = 'tools' | 'skills' | 'recipients' | 'connections' | 'hosts' | 'secrets'

/** The part of the settings catalog that holds grantable items. */
export type CapabilityCatalog = Pick<SettingsCatalog, 'toolGroups' | 'skills' | 'robots' | 'secrets'> & Partial<Pick<SettingsCatalog, 'connections' | 'hosts'>>

export const HOST_FACETS = ['files', 'shell', 'browser'] as const
export type HostFacet = (typeof HOST_FACETS)[number]

/** The Host a host item belongs to: Advanced settings shows one heading per Host (ux-q8o6). */
export interface CapabilityHost {
  readonly id: string
  readonly name: string
  readonly online: boolean
  readonly mine: boolean
  readonly ownerName: string
  /** The platform the Host reports (linux, darwin, win32); the runtime section's Hosts line names it. */
  readonly platform?: string
  /** What the Host's last heartbeat reported: its shell and sandbox state. */
  readonly capabilities?: HostView['capabilities']
}

interface ItemFields {
  /** The name a Grant uses: a tool group, a skill, a Robot id, "<connectionId>" or "<connectionId>:write", "<hostId>:<facet>", a login name. */
  readonly name: string
  /** What a person and the Robot read: the name, "<plugin> · <account>" for a connection, "<host> · <facet>" for a host facet (ux-5g3w, ux-ywxa). */
  readonly label: string
  /** One line. */
  readonly description: string
  readonly level: GrantLevel
}

/** One grantable item; a host facet also names its Host and facet, so that a view can group it under the Host. */
export type CapabilityItem =
  | (ItemFields & { readonly field: Exclude<CapabilityField, 'hosts'> })
  | (ItemFields & { readonly field: 'hosts'; readonly host: CapabilityHost; readonly facet: HostFacet })

/** The sections of the list, in the order Advanced settings shows them. */
export const CAPABILITY_SECTIONS: ReadonlyArray<{ readonly field: CapabilityField; readonly title: string; readonly kind: string }> = [
  { field: 'tools', title: 'Tools', kind: 'tool group' },
  { field: 'skills', title: 'Skills', kind: 'skill' },
  { field: 'recipients', title: 'Recipients', kind: 'recipient' },
  { field: 'connections', title: 'Connections', kind: 'connection' },
  { field: 'hosts', title: 'Hosts', kind: 'host' },
  { field: 'secrets', title: 'Logins', kind: 'login' },
]

const HOST_FACET_TEXT: Readonly<Record<HostFacet, string>> = {
  browser: "Its Chrome, when chosen as this Robot's browser",
  files: 'Read, write, edit, search and copy files on the host as the host owner',
  shell: 'Run commands on the host as the host owner, in their shell',
}

/** The level an item holds: what the set names, deny when it names nothing. */
const levelIn = (levels: Readonly<Record<string, GrantLevel>>, name: string): GrantLevel =>
  Object.hasOwn(levels, name) ? levels[name]! : 'deny'

/** Whether a connection can also write (Gmail send, Slack post, Discord as you): it has a separate "write" grant. */
const canWrite = (connection: { readonly kind: string; readonly services: readonly string[] }): boolean =>
  connection.kind === 'slack' || connection.kind === 'discord-user' || (connection.kind === 'google' && connection.services.includes('gmail-send'))

/** What a connection's write grant allows, as its item names it. */
const WRITE_TEXT: Readonly<Record<string, string>> = { google: 'send e-mail', 'discord-user': 'send, reply, react and mark read' }

/** A Host's state as the settings heading, my_capabilities and the runtime section show it: "online", "offline · Anna's". */
export const hostState = (host: CapabilityHost): string => `${host.online ? 'online' : 'offline'}${host.mine ? '' : ` · ${host.ownerName}'s`}`

/** The heading of a Host's facets: "Desk · online". */
export const hostHeading = (host: CapabilityHost): string => `${host.name} · ${hostState(host)}`

const PLATFORM_NAMES: Readonly<Record<string, string>> = { darwin: 'macOS', win32: 'Windows' }

/**
 * A Host as the runtime section names it: its heading, the shell its commands run in on its platform, and its sandbox state
 * as the last heartbeat reported them (ob-gjp9, ob-vyyg): "Desk · online · bash on linux · sandbox full".
 */
export const hostLine = (host: CapabilityHost): string => {
  const shell = host.capabilities?.shell
  const platform = host.platform === undefined ? undefined : (PLATFORM_NAMES[host.platform] ?? host.platform)
  const runs = shell === undefined ? platform : platform === undefined ? shell : `${shell} on ${platform}`
  const sandbox = host.capabilities?.sandbox
  return [hostHeading(host), runs, sandbox === undefined ? undefined : `sandbox ${sandbox}`].filter((part): part is string => part !== undefined).join(' · ')
}

/** The Hosts the host items belong to, each once, in the order of the items. */
export function hostsOf(items: readonly CapabilityItem[]): CapabilityHost[] {
  return items.flatMap((entry) => (entry.field === 'hosts' ? [entry.host] : [])).filter((host, index, all) => all.findIndex((other) => other.id === host.id) === index)
}

/** Every grantable item of the catalog with its level under `grants`, section by section. */
export function capabilityItems(catalog: CapabilityCatalog, grants: GrantSet): CapabilityItem[] {
  const item = (field: Exclude<CapabilityField, 'hosts'>, name: string, label: string, description: string): CapabilityItem => ({ field, name, label, description, level: levelIn(grants[field], name) })
  const facet = (host: CapabilityHost, facet: HostFacet): CapabilityItem => {
    const name = `${host.id}:${facet}`
    return { field: 'hosts', name, label: `${host.name} · ${facet}`, description: HOST_FACET_TEXT[facet], level: levelIn(grants.hosts, name), host, facet }
  }
  return [
    ...catalog.toolGroups.map((group) => item('tools', group.name, group.name, group.description)),
    ...catalog.skills.map((skill) => item('skills', skill.name, skill.name, skill.description)),
    ...catalog.robots.map((robot) => item('recipients', robot.id, robot.name, 'A Robot you may message.')),
    // Plugin tools, one item per connected account, labelled with its plugin (ux-5g3w): "Google · anna@example.com".
    ...(catalog.connections ?? []).flatMap((connection) => {
      const label = `${connection.pluginTitle} · ${connection.account}`
      const description = [
        canWrite(connection) ? 'Read tools as this account' : 'Plugin tools as this account',
        connection.label === connection.account ? undefined : `named "${connection.label}"`,
        connection.mine ? undefined : `${connection.ownerName}'s`,
        connection.status === 'connected' ? undefined : 'needs attention',
      ].filter((part) => part !== undefined).join(' · ')
      const read = item('connections', connection.id, label, description)
      return canWrite(connection)
        ? [read, item('connections', `${connection.id}:write`, `${label}: ${WRITE_TEXT[connection.kind] ?? 'post and mark read'}`, 'A separate grant: without it the Robot only reads')]
        : [read]
    }),
    ...(catalog.hosts ?? []).flatMap((host) => HOST_FACETS.map((name) => facet(host, name))),
    ...catalog.secrets.map((secret) => item('secrets', secret.name, secret.name,
      [secret.username, (secret.websites ?? []).join(', '), secret.scope === 'home' ? 'shared with the Space' : 'yours'].filter((part) => part !== undefined && part !== '').join(' · '))),
  ]
}

/** A Robot's owner: their name and, when they set one, the nickname to address them by (ux-i8ff). */
export interface RobotOwner {
  readonly name: string
  readonly nickname?: string
}

/** The owner line the runtime section and my_capabilities share (ux-nwi1, ux-xzdh): "Anna Kowalska; address them as Ania". */
export const ownerLine = (owner: RobotOwner): string =>
  owner.nickname === undefined ? owner.name : `${owner.name}; address them as ${owner.nickname}`

const kindOf = (field: CapabilityField): string => CAPABILITY_SECTIONS.find((section) => section.field === field)!.kind

export interface CapabilitiesView {
  /** Who the Robot works for, as the runtime section says it. */
  readonly owner: string
  readonly allow: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly grant: string; readonly description: string }>
  readonly ask: CapabilitiesView['allow']
  readonly deny: CapabilitiesView['allow']
  readonly note: string
}

/** What my_capabilities returns: the owner line, the items grouped by level, and how a level changes. A host facet says whether its Host is online. */
export function capabilitiesView(items: readonly CapabilityItem[], owner: RobotOwner): CapabilitiesView {
  const described = (entry: CapabilityItem) => (entry.field === 'hosts' ? `${entry.description} · ${hostState(entry.host)}` : entry.description)
  const at = (level: GrantLevel) => items.filter((entry) => entry.level === level).map((entry) => ({ kind: kindOf(entry.field), name: entry.label, grant: entry.name, description: described(entry) }))
  return {
    owner: ownerLine(owner),
    allow: at('allow'),
    ask: at('ask'),
    deny: at('deny'),
    note: 'allow: use freely. ask: each call waits for your owner\'s answer. deny: you do not have it. You can change a level only through propose_grants; name an item by its "grant" value.',
  }
}

/** The most names one kind lists in the summary; the rest is counted. */
const SUMMARY_NAMES = 12
const shown = (names: readonly string[]): string =>
  names.length <= SUMMARY_NAMES ? names.join(', ') : `${names.slice(0, SUMMARY_NAMES).join(', ')} and ${names.length - SUMMARY_NAMES} more`

/**
 * The runtime section's level summary: one line per level, grouped by kind, so that the text stays
 * short and stable between Turns. Allow and ask list names. Deny lists the tool groups by name and
 * counts the rest (a library of skills, every other Robot, every host facet would fill the prompt);
 * the full list with descriptions is my_capabilities.
 */
export function levelSummary(items: readonly CapabilityItem[]): string {
  const line = (level: GrantLevel) => {
    const groups = CAPABILITY_SECTIONS
      .map((section) => ({ field: section.field, kind: section.title.toLowerCase(), names: items.filter((entry) => entry.level === level && entry.field === section.field).map((entry) => entry.label) }))
      .filter((group) => group.names.length > 0)
    const text = (group: (typeof groups)[number]) => `${group.kind} ${level === 'deny' && group.field !== 'tools' ? String(group.names.length) : shown(group.names)}`
    return `${level}: ${groups.length === 0 ? 'none' : groups.map(text).join('; ')}`
  }
  return ['allow', 'ask', 'deny'].map((level) => line(level as GrantLevel)).join('\n')
}
