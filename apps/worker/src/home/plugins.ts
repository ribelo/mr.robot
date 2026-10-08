/**
 * The Home's plugins and shared connections (v1.5 ticket 01): which plugins are on (cn-dbm9), each
 * plugin's settings from its schema with secret fields sealed apart (cn-s1pd, cn-a1i0), and the index
 * of connections Members share with the Home (cn-qs78).
 */
import * as Effect from 'effect/Effect'
import type { ConnectionView, PluginView } from '@mr-robot/protocol'
import { describeSchema, parseForm, PluginConfigInvalid, type PlainValue } from '../connectors/schema-form.ts'
import type { OwnConnection } from '../member/connections.ts'
import { PLUGINS, pluginByName, type PluginEntry } from '../plugins/catalog.ts'
import type { VaultShape } from '../platform/vault.ts'

export class PluginNotFound extends Error {}

export class HomePlugins {
  constructor(private readonly sql: SqlStorage, private readonly vault: VaultShape) {
    sql.exec('CREATE TABLE IF NOT EXISTS plugin (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL, config TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS plugin_secret (name TEXT NOT NULL, field TEXT NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY (name, field)) WITHOUT ROWID')
    sql.exec('CREATE TABLE IF NOT EXISTS shared_connection (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, view TEXT NOT NULL)')
  }

  // ---------------------------------------------------------------- plugins

  /** Plugins are on unless the Home switched them off. */
  enabled(): Record<string, boolean> {
    const rows = this.sql.exec<{ name: string; enabled: number }>('SELECT name, enabled FROM plugin').toArray()
    return Object.fromEntries(PLUGINS.map((plugin) => [plugin.name, rows.find((row) => row.name === plugin.name)?.enabled !== 0]))
  }

  private values(name: string): Record<string, PlainValue> {
    const row = this.sql.exec<{ config: string }>('SELECT config FROM plugin WHERE name = ?', name).toArray()[0]
    return row === undefined ? {} : (JSON.parse(row.config) as Record<string, PlainValue>)
  }

  private secretsSet(name: string): Set<string> {
    return new Set(this.sql.exec<{ field: string }>('SELECT field FROM plugin_secret WHERE name = ?', name).toArray().map((row) => row.field))
  }

  view(plugin: PluginEntry, isAdmin: boolean, origin: string): PluginView {
    const values = this.values(plugin.name)
    const secretsSet = this.secretsSet(plugin.name)
    const connect = plugin.connector?.connect
    return {
      name: plugin.name, title: plugin.title, description: plugin.description, icon: plugin.icon, group: plugin.group,
      enabled: this.enabled()[plugin.name] ?? true,
      // Only the admin sees the Home's settings; everyone sees whether setup is missing.
      fields: isAdmin && plugin.homeConfig !== undefined ? describeSchema(plugin.homeConfig) : [],
      values: isAdmin ? values : {},
      secretsSet: isAdmin ? [...secretsSet] : [],
      setupNeeded: plugin.setupNeeded?.(values, secretsSet) ?? null,
      guide: isAdmin ? plugin.guide?.(origin) ?? null : null,
      connector: plugin.connector === undefined || connect === undefined ? null : {
        kind: plugin.connector.kind,
        connect: connect.method === 'oauth'
          ? { method: 'oauth', services: connect.services }
          : { method: 'paste', fields: describeSchema(connect.schema), instructions: connect.instructions },
      },
    }
  }

  list(isAdmin: boolean, origin: string): PluginView[] {
    return PLUGINS.map((plugin) => this.view(plugin, isAdmin, origin))
  }

  setEnabled(name: string, enabled: boolean): void {
    if (pluginByName(name) === undefined) throw new PluginNotFound(name)
    this.sql.exec("INSERT INTO plugin (name, enabled, config) VALUES (?, ?, '{}') ON CONFLICT (name) DO UPDATE SET enabled = excluded.enabled", name, enabled ? 1 : 0)
  }

  /** Save the detail page's form: plain values in the configuration, secrets sealed apart. */
  async setConfig(name: string, input: Readonly<Record<string, unknown>>, origin: string): Promise<PluginView> {
    const plugin = pluginByName(name)
    if (plugin === undefined) throw new PluginNotFound(name)
    if (plugin.homeConfig === undefined) throw new PluginConfigInvalid({ plugin: name, message: 'this plugin has no settings' })
    const parsed = parseForm(name, plugin.homeConfig, input, this.secretsSet(name))
    if (!parsed.ok) throw parsed.error
    this.sql.exec("INSERT INTO plugin (name, enabled, config) VALUES (?, 1, ?) ON CONFLICT (name) DO UPDATE SET config = excluded.config", name, JSON.stringify(parsed.values))
    for (const [field, value] of Object.entries(parsed.secrets)) {
      const sealed = await Effect.runPromise(this.vault.seal(value))
      this.sql.exec('INSERT INTO plugin_secret (name, field, sealed) VALUES (?, ?, ?) ON CONFLICT (name, field) DO UPDATE SET sealed = excluded.sealed', name, field, sealed)
    }
    return this.view(plugin, true, origin)
  }

  /** A plugin's setting for the platform's own use (an OAuth client); secrets opened now, never sent to a browser. */
  async settings(name: string): Promise<{ values: Record<string, PlainValue>; secrets: Record<string, string> }> {
    const rows = this.sql.exec<{ field: string; sealed: string }>('SELECT field, sealed FROM plugin_secret WHERE name = ?', name).toArray()
    const secrets: Record<string, string> = {}
    for (const row of rows) secrets[row.field] = await Effect.runPromise(this.vault.open(row.sealed))
    return { values: this.values(name), secrets }
  }

  async setSecret(name: string, field: string, value: string | null): Promise<void> {
    if (value === null) {
      this.sql.exec('DELETE FROM plugin_secret WHERE name = ? AND field = ?', name, field)
      return
    }
    const sealed = await Effect.runPromise(this.vault.seal(value))
    this.sql.exec('INSERT INTO plugin_secret (name, field, sealed) VALUES (?, ?, ?) ON CONFLICT (name, field) DO UPDATE SET sealed = excluded.sealed', name, field, sealed)
  }

  // ---------------------------------------------------------------- shared connections

  connectionShared(ownerId: string, connection: OwnConnection, shared: boolean): void {
    if (shared) this.sql.exec('INSERT INTO shared_connection (id, owner_id, view) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, view = excluded.view', connection.id, ownerId, JSON.stringify(connection))
    else this.sql.exec('DELETE FROM shared_connection WHERE id = ?', connection.id)
  }

  /** Connections other Members share with the Home. */
  sharedBy(exceptOwner: string): Array<{ ownerId: string; connection: OwnConnection }> {
    return this.sql.exec<{ owner_id: string; view: string }>('SELECT owner_id, view FROM shared_connection WHERE owner_id <> ?', exceptOwner).toArray()
      .map((row) => ({ ownerId: row.owner_id, connection: JSON.parse(row.view) as OwnConnection }))
  }

  sharedOwner(id: string): string | null {
    return this.sql.exec<{ owner_id: string }>('SELECT owner_id FROM shared_connection WHERE id = ?', id).toArray()[0]?.owner_id ?? null
  }

  forgetOwner(ownerId: string): void {
    this.sql.exec('DELETE FROM shared_connection WHERE owner_id = ?', ownerId)
  }
}

/** A stored connection as a person sees it. */
export function connectionView(connection: OwnConnection, ownerId: string, ownerName: string, viewer: string): ConnectionView {
  return { ...connection, ownerId, ownerName, mine: ownerId === viewer }
}
