import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import type { ProviderCredential, ProviderId } from '../src/agent/providers.ts'
import { StubLlm } from './stub-llm.ts'

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

  /** Skip the setup interview: the Robot becomes active with its current Grants. */
  async activateForTest(): Promise<void> {
    this.store.updateConfig(() => ({ status: 'active' }))
  }

  /** Pretend the Robot was down: every Routine's next run moves into the past by `ms`. */
  async backdateRoutinesForTest(ms: number): Promise<void> {
    for (const routine of this.store.routines()) {
      if (routine.nextRun !== null) this.store.saveRoutine({ ...routine, nextRun: Date.now() - ms, createdAt: routine.createdAt - ms })
    }
    await this.ctx.storage.setAlarm(Date.now() - ms)
  }

  async alarmForTest(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }
}