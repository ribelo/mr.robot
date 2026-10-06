/**
 * One Member (a person): profile, preferences, Member files (USER.md and
 * PROACTIVE_PREFERENCES.md, mounted read-only into each of their Robots), and the
 * Member's private secrets, Provider credentials, push subscriptions and usage.
 */
import { DurableObject } from 'cloudflare:workers'
import type { QuietHours } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { MEMBER_FILES } from '../workspace/templates.ts'

export type MemberFileName = 'USER.md' | 'PROACTIVE_PREFERENCES.md'
export const MEMBER_FILE_NAMES: readonly MemberFileName[] = ['USER.md', 'PROACTIVE_PREFERENCES.md']

export interface MemberProfile {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly timeZone: string
  readonly quietHours: QuietHours | null
}

export class Member extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS member_file (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)')
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  async init(input: { id: string; email: string; name: string }): Promise<MemberProfile> {
    const existing = this.get<MemberProfile>('profile')
    if (existing !== undefined) return existing
    const profile: MemberProfile = { ...input, timeZone: 'Europe/Warsaw', quietHours: null }
    this.ctx.storage.transactionSync(() => {
      this.set('profile', profile)
      for (const name of MEMBER_FILE_NAMES) {
        this.sql.exec(
          'INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING',
          name, MEMBER_FILES[name].replace('{{name}}', input.name), Date.now(),
        )
      }
    })
    return profile
  }

  profile(): MemberProfile {
    const profile = this.get<MemberProfile>('profile')
    if (profile === undefined) throw new Error('member is not initialised')
    return profile
  }

  updateProfile(patch: { name?: string; timeZone?: string; quietHours?: QuietHours | null }): MemberProfile {
    const next = { ...this.profile(), ...patch }
    this.set('profile', next)
    return next
  }

  // ---------------------------------------------------------------- Member files (robot-mj7v)

  file(name: MemberFileName): string {
    return this.sql.exec<{ content: string }>('SELECT content FROM member_file WHERE name = ?', name).toArray()[0]?.content ?? ''
  }

  files(): Record<MemberFileName, string> {
    return { 'USER.md': this.file('USER.md'), 'PROACTIVE_PREFERENCES.md': this.file('PROACTIVE_PREFERENCES.md') }
  }

  /** Only the Member writes their files, directly or by approving a Robot's proposal. */
  writeFile(name: MemberFileName, content: string): void {
    this.sql.exec(
      'INSERT INTO member_file (name, content, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      name, content, Date.now(),
    )
  }

  // ---------------------------------------------------------------- small values

  protected get<T>(key: string): T | undefined {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM kv WHERE k = ?', key).toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.v) as T)
  }

  protected set(key: string, value: unknown): void {
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
  }
}
