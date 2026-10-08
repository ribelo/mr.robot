/**
 * A Member's connections (v1.5, cn-qs78, cn-bsge, cn-a1i0): accounts of Google, Slack and Discord.
 * Each row holds what the connection is; its secrets are sealed in the Member's vault, one per field,
 * and the row only references them. Shared connections are published to the Home's index.
 */
import * as Effect from 'effect/Effect'
import type { ConnectionStatus, ConnectionView, ConnectorKind } from '@mr-robot/protocol'

/** Connector state kept with a connection (token expiry, team id); flat values, never a secret. */
export type ConnectionMeta = Readonly<Record<string, string | number | boolean | null>>
import type { VaultShape } from '../platform/vault.ts'

/** A connection as its owner stores it; owner fields are added by the Home. */
export type OwnConnection = Omit<ConnectionView, 'ownerId' | 'ownerName' | 'mine'>

export interface NewConnection {
  readonly kind: ConnectorKind
  readonly label: string
  readonly account: string
  readonly services: readonly string[]
  readonly shared: boolean
  readonly meta: ConnectionMeta
  readonly secrets: Readonly<Record<string, string>>
}

export interface ConnectionChange {
  readonly label?: string
  readonly account?: string
  readonly shared?: boolean
  readonly isDefault?: boolean
  readonly services?: readonly string[]
  readonly status?: ConnectionStatus
  readonly statusNote?: string | null
  readonly meta?: ConnectionMeta
  readonly secrets?: Readonly<Record<string, string>>
}

type Row = {
  id: string; kind: ConnectorKind; label: string; account: string; shared: number; is_default: number
  services: string; status: ConnectionStatus; status_note: string | null; meta: string; created_at: number
}

export class ConnectionStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly vault: VaultShape,
    /** A shared connection changed or stopped being shared: the Home's index follows. */
    private readonly publish: (connection: OwnConnection, shared: boolean) => Promise<void>,
    /** A connection was added: the connector's skills go into the library. */
    private readonly added: () => Promise<void> = async () => undefined,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS connection (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, account TEXT NOT NULL, shared INTEGER NOT NULL,
      is_default INTEGER NOT NULL, services TEXT NOT NULL, status TEXT NOT NULL, status_note TEXT, meta TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`)
    sql.exec('CREATE TABLE IF NOT EXISTS connection_secret (connection_id TEXT NOT NULL, field TEXT NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY (connection_id, field)) WITHOUT ROWID')
  }

  private view(row: Row): OwnConnection {
    return {
      id: row.id, kind: row.kind, label: row.label, account: row.account, shared: row.shared === 1, isDefault: row.is_default === 1,
      services: JSON.parse(row.services) as string[], status: row.status, statusNote: row.status_note, createdAt: row.created_at,
      setupLink: typeof (JSON.parse(row.meta) as Record<string, unknown>)['setupLink'] === 'string' ? (JSON.parse(row.meta) as Record<string, string>)['setupLink']! : null,
      setupLabel: typeof (JSON.parse(row.meta) as Record<string, unknown>)['setupLabel'] === 'string' ? (JSON.parse(row.meta) as Record<string, string>)['setupLabel']! : null,
    }
  }

  private row(id: string): Row | undefined {
    return this.sql.exec<Row>('SELECT * FROM connection WHERE id = ?', id).toArray()[0]
  }

  list(): OwnConnection[] {
    return this.sql.exec<Row>('SELECT * FROM connection ORDER BY kind, created_at').toArray().map((row) => this.view(row))
  }

  get(id: string): OwnConnection | undefined {
    const row = this.row(id)
    return row === undefined ? undefined : this.view(row)
  }

  async add(input: NewConnection): Promise<OwnConnection> {
    const id = `c-${crypto.randomUUID()}`
    const now = Date.now()
    // The first connection of a kind is the default one.
    const first = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM connection WHERE kind = ?', input.kind).one().n === 0
    this.sql.exec('INSERT INTO connection (id, kind, label, account, shared, is_default, services, status, status_note, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
      id, input.kind, input.label, input.account, input.shared ? 1 : 0, first ? 1 : 0, JSON.stringify(input.services), 'connected', JSON.stringify(input.meta), now, now)
    await this.sealSecrets(id, input.secrets)
    const view = this.get(id)!
    if (view.shared) await this.publish(view, true)
    await this.added()
    return view
  }

  async update(id: string, change: ConnectionChange): Promise<OwnConnection | undefined> {
    const row = this.row(id)
    if (row === undefined) return undefined
    const meta = change.meta === undefined ? row.meta : JSON.stringify({ ...(JSON.parse(row.meta) as object), ...change.meta })
    this.sql.exec('UPDATE connection SET label = ?, account = ?, shared = ?, services = ?, status = ?, status_note = ?, meta = ?, updated_at = ? WHERE id = ?',
      change.label ?? row.label, change.account ?? row.account, change.shared === undefined ? row.shared : change.shared ? 1 : 0,
      change.services === undefined ? row.services : JSON.stringify(change.services), change.status ?? row.status,
      change.statusNote === undefined ? row.status_note : change.statusNote, meta, Date.now(), id)
    if (change.isDefault === true) {
      this.sql.exec('UPDATE connection SET is_default = 0 WHERE kind = ?', row.kind)
      this.sql.exec('UPDATE connection SET is_default = 1 WHERE id = ?', id)
    }
    if (change.secrets !== undefined) await this.sealSecrets(id, change.secrets)
    const view = this.get(id)!
    if (view.shared || row.shared === 1) await this.publish(view, view.shared)
    return view
  }

  async remove(id: string): Promise<boolean> {
    const view = this.get(id)
    if (view === undefined) return false
    this.sql.exec('DELETE FROM connection WHERE id = ?', id)
    this.sql.exec('DELETE FROM connection_secret WHERE connection_id = ?', id)
    // Another connection of the kind becomes the default.
    if (view.isDefault) this.sql.exec('UPDATE connection SET is_default = 1 WHERE id = (SELECT id FROM connection WHERE kind = ? ORDER BY created_at LIMIT 1)', view.kind)
    if (view.shared) await this.publish(view, false)
    return true
  }

  /** The connection's secrets, opened from the vault now, and its connector state. */
  async use(id: string): Promise<{ connection: OwnConnection; secrets: Record<string, string>; meta: ConnectionMeta } | undefined> {
    const row = this.row(id)
    if (row === undefined) return undefined
    const sealed = this.sql.exec<{ field: string; sealed: string }>('SELECT field, sealed FROM connection_secret WHERE connection_id = ?', id).toArray()
    const secrets: Record<string, string> = {}
    for (const entry of sealed) secrets[entry.field] = await Effect.runPromise(this.vault.open(entry.sealed))
    return { connection: this.view(row), secrets, meta: JSON.parse(row.meta) as ConnectionMeta }
  }

  private async sealSecrets(id: string, secrets: Readonly<Record<string, string>>): Promise<void> {
    for (const [field, value] of Object.entries(secrets)) {
      const sealed = await Effect.runPromise(this.vault.seal(value))
      this.sql.exec('INSERT INTO connection_secret (connection_id, field, sealed) VALUES (?, ?, ?) ON CONFLICT (connection_id, field) DO UPDATE SET sealed = excluded.sealed', id, field, sealed)
    }
  }
}
