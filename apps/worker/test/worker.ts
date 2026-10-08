import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import type { ProviderCredential, ProviderId } from '../src/agent/providers.ts'
import { StubLlm } from './stub-llm.ts'
import { StubDriver } from './stub-browser.ts'
import { FakeChannel } from './fake-channel.ts'
import { fakeConnectors, fakeService } from './fake-connector.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import type { ChannelAdapter, InboundEvent } from '../src/channels/channel.ts'
import type { BrowserDriver } from '../src/browser/driver.ts'
import type { BrowserBackend } from '@mr-robot/protocol'

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
    return delivered.get((await this.profile()).id) ?? []
  }

  protected override async deliver(notification: PushNotification): Promise<void> {
    const id = (await this.profile()).id
    const list = delivered.get(id) ?? []
    list.push(notification)
    delivered.set(id, list)
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
  /** Fake connectors set by a test replace the real ones; their HTTP is the recorded fake service. */
  protected override connectorPlugins() {
    return fakeConnectors.size === 0 ? super.connectorPlugins() : Object.fromEntries(fakeConnectors)
  }

  protected override connectorFetch(): typeof globalThis.fetch {
    return fakeConnectors.size === 0 ? connectorFixtures.fetch : fakeService
  }

  protected override adapter(provider: string, contextWindow?: number, model?: string, wire?: 'chat' | 'anthropic' | 'responses'): LlmAdapter {
    return provider === 'stub' ? new StubLlm(this.store.requireConfig().id) : super.adapter(provider, contextWindow, model, wire)
  }

  /** The credential this Robot's Turns would use for a Provider. */
  async credentialForTest(provider: ProviderId): Promise<ProviderCredential | null> {
    return (await this.credentials().resolve(provider)) ?? null
  }

  protected override channels(): Map<string, ChannelAdapter> {
    const channels = super.channels()
    channels.set('fake', new FakeChannel())
    return channels
  }

  /** Channel events as the edge would deliver them. */
  override async channelEvent(event: InboundEvent): Promise<{ accepted: boolean }> {
    return super.channelEvent(event)
  }

  protected override browserDriver(backend: BrowserBackend): BrowserDriver {
    return new StubDriver(backend)
  }

  /** Skip the setup interview: the Robot becomes active with its current Grants. */
  async activateForTest(): Promise<void> {
    this.store.updateConfig(() => ({ status: 'active' }))
    await this.changed()
  }

  /** Pretend the Robot was down: every Routine's next run moves into the past by `ms`. */
  async backdateRoutinesForTest(ms: number): Promise<void> {
    for (const routine of this.store.routines()) {
      // Back in time as if the DO had slept: the stored DSH record's target moves too.
      if (routine.nextRun !== null) this.store.saveRoutine({ ...routine, nextRun: Date.now() - ms, createdAt: routine.createdAt - ms, record: { ...routine.record, scheduledAt: new Date(Date.now() - ms).toISOString() } })
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

  /** A PNG screenshot in the Workspace, as a Turn with the browser leaves one. */
  async saveScreenForTest(): Promise<void> {
    await this.saveScreen(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 5, 0, 0, 0, 3, 32, 0, 255]))
  }

  async outboxForTest(): Promise<Array<{ id: string; status: string }>> {
    return this.store.sql.exec<{ id: string; status: string }>('SELECT id, status FROM outbox').toArray()
  }

  /** Make the screen watch due now. */
  async watchDueForTest(): Promise<void> {
    this.store.set('watch-next', Date.now() - 1)
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
  }

  async alarmForTest(): Promise<number | null> {
    return this.ctx.storage.getAlarm()
  }
}