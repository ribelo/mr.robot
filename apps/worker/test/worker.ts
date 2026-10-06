import { Robot as ProductionRobot } from '../src/robot/robot.ts'
import { StubLlm } from './stub-llm.ts'

export { default } from '../src/index.ts'

export class Robot extends ProductionRobot {
  protected override llmAdapters() {
    return [[['stub'], new StubLlm(this.ctx.id.name ?? this.ctx.id.toString())]] as const
  }
}
