import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import { StubLlm } from './stub-llm.ts'

export { default, Home, Member } from '../src/index.ts'

/** The production Robot with the scripted stub model on the "stub" Provider. */
export class Robot extends ProductionRobot {
  protected override adapter(provider: string): LlmAdapter {
    return provider === 'stub' ? new StubLlm(this.store.requireConfig().id) : super.adapter(provider)
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