import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { scripts } from './stub-llm.ts'

describe('Robot DO runs a turn', () => {
  it('answers a message and persists the log (robot-frf5)', async () => {
    scripts.set('r1', [{ text: 'Hello, owner.' }])
    const robot = env.ROBOT.getByName('r1')
    await robot.send('Hi')
    await robot.idle()
    const events = await robot.events()
    const types = events.map((event) => event.type)
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')
    expect(types.at(-1)).toBe('turn/end')
  })
})
