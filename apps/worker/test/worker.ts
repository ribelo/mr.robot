import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import type { ProviderCredential, ProviderId } from '../src/agent/providers.ts'
import { StubLlm } from './stub-llm.ts'
import { StubDriver } from './stub-browser.ts'
import type { BrowserDriver } from '../src/browser/driver.ts'

import { Member as ProductionMember } from '../src/member/member.ts'
import type { PushNotification } from '../src/platform/push.ts'

export const delivered = new Map<string, PushNotification[]>()

export { default, Home } from '../src/index.ts'

/** The production Member with a clock hook for OAuth expiry. */
export class Member extends ProductionMember {
  async expireCredentialsForTest(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE credential SET expires = 0')
  }

  /** Every notification delivered to devices, in order. */
  async deliveredForTest(): Promise<PushNotification[]> {
    return delivered.get(this.profile().id) ?? []
  }

  protected override async deliver(notification: PushNotification): Promise<void> {
    const list = delivered.get(this.profile().id) ?? []
    list.push(notification)
    delivered.set(this.profile().id, list)
    await super.deliver(notification)
  }

  async endQuietHoursForTest(): Promise<void> {
    this.ctx.storage.sql.exec('UPDATE pending_notification SET deliver_at = 0')
  }

  async sealedForTest(provider: string): Promise<string> {
    return this.ctx.storage.sql.exec<{ sealed: string }>('SELECT sealed FROM credential WHERE provider = ?', provider).one().sealed
  }
}

/** The production Robot with the scripted stub model on the "stub" Provider. */
export class Robot extends ProductionRobot {
  protected override adapter(provider: string, contextWindow?: number): LlmAdapter {
    return provider === 'stub' ? new StubLlm(this.store.requireConfig().id) : super.adapter(provider, contextWindow)
  }

  /** The credential this Robot's Turns would use for a Provider. */
  async credentialForTest(provider: ProviderId): Promise<ProviderCredential | null> {
    return (await this.credentials().resolve(provider)) ?? null
  }

  protected override browserDriver(): BrowserDriver {
    return new StubDriver()
  }

  /** Skip the setup interview: the Robot becomes active with its current Grants. */
  async activateForTest(): Promise<void> {
    this.store.updateConfig(() => ({ status: 'active' }))
    await this.changed()
  }

  /** Pretend the Robot was down: every Routine's next run moves into the past by `ms`. */
  async backdateRoutinesForTest(ms: number): Promise<void> {
    for (const routine of this.store.routines()) {
      if (routine.nextRun !== null) this.store.saveRoutine({ ...routine, nextRun: Date.now() - ms, createdAt: routine.createdAt - ms })
    }
    await this.ctx.storage.setAlarm(Date.now() - ms)
  }

  /** Put a message in the outbox without delivering it (as if the DO died right after writing). */
  async outboxOnlyForTest(to: string, text: string, key: string): Promise<string> {
    const config = this.store.requireConfig()
    const id = `msg-test-${key}`
    this.store.sql.exec(
      "INSERT INTO outbox (id, recipient, payload, status, attempts, next_attempt, created_at) VALUES (?, ?, ?, 'pending', 0, 0, ?)",
      id, to, JSON.stringify({ id, kind: 'request', from: { robotId: config.id, ownerId: config.ownerId, name: config.identity.name, avatarColor: config.identity.avatarColor }, text, requestId: id, chain: { id: 'c', hops: 1 } }), Date.now(),
    )
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
    return id
  }

  async outboxForTest(): Promise<Array<{ id: string; status: string }>> {
    return this.store.sql.exec<{ id: string; status: string }>('SELECT id, status FROM outbox').toArray()
  }

  async alarmForTest(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }
}