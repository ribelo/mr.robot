/**
 * What a Robot may do, as one list (v1.11 ticket 04, sk-e1hh, sk-ixvp): every grantable item of the
 * settings catalog with the level the Robot holds on it. Advanced settings, the my_capabilities tool and
 * the runtime section of the prompt all read this list, so the three never disagree.
 *
 * Self-contained on purpose (type imports only): index.ts re-exports it.
 */
import type { GrantLevel, GrantSet, SettingsCatalog } from './index.ts'

export type CapabilityField = 'tools' | 'skills' | 'recipients' | 'connections' | 'hosts' | 'secrets'

/** The part of the settings catalog that holds grantable items. */
export type CapabilityCatalog = Pick<SettingsCatalog, 'toolGroups' | 'skills' | 'robots' | 'secrets'> & Partial<Pick<SettingsCatalog, 'connections' | 'hosts'>>

export interface CapabilityItem {
  /** The GrantSet field the item belongs to. */
  readonly field: CapabilityField
  /** The name a Grant uses: a tool group, a skill, a Robot id, "<connectionId>" or "<connectionId>:write", "<hostId>:<facet>", a login name. */
  readonly name: string
  /** What a person reads: the name, or the account's or computer's name. */
  readonly label: string
  /** One line. */
  readonly description: string
  readonly level: GrantLevel
}

/** The sections of the list, in the order Advanced settings shows them. */
export const CAPABILITY_SECTIONS: ReadonlyArray<{ readonly field: CapabilityField; readonly title: string; readonly kind: string }> = [
  { field: 'tools', title: 'Tools', kind: 'tool group' },
  { field: 'skills', title: 'Skills', kind: 'skill' },
  { field: 'recipients', title: 'Recipients', kind: 'recipient' },
  { field: 'connections', title: 'Connections', kind: 'connection' },
  { field: 'hosts', title: 'Hosts', kind: 'host' },
  { field: 'secrets', title: 'Logins', kind: 'login' },
]

const HOST_FACETS = ['browser', 'files', 'shell'] as const
const HOST_FACET_TEXT: Readonly<Record<(typeof HOST_FACETS)[number], string>> = {
  browser: "Its Chrome, when chosen as this Robot's browser",
  files: 'host_read, host_write as the host owner',
  shell: "host_run as the host owner, in their shell",
}

/** The level an item holds: what the set names, deny when it names nothing. */
const levelIn = (levels: Readonly<Record<string, GrantLevel>>, name: string): GrantLevel =>
  Object.hasOwn(levels, name) ? levels[name]! : 'deny'

/** Whether a connection can also write (Gmail send, Slack post): it has a separate "write" grant. */
const canWrite = (connection: { readonly kind: string; readonly services: readonly string[] }): boolean =>
  connection.kind === 'slack' || (connection.kind === 'google' && connection.services.includes('gmail-send'))

/** Every grantable item of the catalog with its level under `grants`, section by section. */
export function capabilityItems(catalog: CapabilityCatalog, grants: GrantSet): CapabilityItem[] {
  const item = (field: CapabilityField, name: string, label: string, description: string): CapabilityItem => ({ field, name, label, description, level: levelIn(grants[field], name) })
  return [
    ...catalog.toolGroups.map((group) => item('tools', group.name, group.name, group.description)),
    ...catalog.skills.map((skill) => item('skills', skill.name, skill.name, skill.description)),
    ...catalog.robots.map((robot) => item('recipients', robot.id, robot.name, 'A Robot you may message.')),
    ...(catalog.connections ?? []).flatMap((connection) => {
      const read = item('connections', connection.id, connection.label, `${connection.kind} · ${connection.account}${connection.mine ? '' : ` · ${connection.ownerName}'s`}${connection.status === 'connected' ? '' : ' · needs attention'}`)
      return canWrite(connection)
        ? [read, item('connections', `${connection.id}:write`, `${connection.label}: ${connection.kind === 'google' ? 'send e-mail' : 'post and mark read'}`, 'A separate grant: without it the Robot only reads')]
        : [read]
    }),
    ...(catalog.hosts ?? []).flatMap((host) => HOST_FACETS.map((facet) =>
      item('hosts', `${host.id}:${facet}`, `${host.name}: ${facet}`, `${HOST_FACET_TEXT[facet]} · ${host.online ? 'online' : 'offline'}${host.mine ? '' : ` · ${host.ownerName}'s`}`))),
    ...catalog.secrets.map((secret) => item('secrets', secret.name, secret.name,
      [secret.username, (secret.websites ?? []).join(', '), secret.scope === 'home' ? 'shared with the Home' : 'yours'].filter((part) => part !== undefined && part !== '').join(' · '))),
  ]
}

const kindOf = (field: CapabilityField): string => CAPABILITY_SECTIONS.find((section) => section.field === field)!.kind

export interface CapabilitiesView {
  readonly allow: ReadonlyArray<{ readonly kind: string; readonly name: string; readonly grant: string; readonly description: string }>
  readonly ask: CapabilitiesView['allow']
  readonly deny: CapabilitiesView['allow']
  readonly note: string
}

/** What my_capabilities returns: the items grouped by level, and how a level changes. */
export function capabilitiesView(items: readonly CapabilityItem[]): CapabilitiesView {
  const at = (level: GrantLevel) => items.filter((entry) => entry.level === level).map((entry) => ({ kind: kindOf(entry.field), name: entry.label, grant: entry.name, description: entry.description }))
  return {
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
