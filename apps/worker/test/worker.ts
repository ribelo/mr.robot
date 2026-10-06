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
}