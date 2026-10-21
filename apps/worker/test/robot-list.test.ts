import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RobotSummary } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await testRobot(body.id).activateForTest()
  return body.id
}

describe('the robot list (robot-mktj, robot-n7th)', () => {
  it('pins, hides and marks unread per person; opening the conversation reads it', async () => {
    const id = await activeRobot()
    const entry = async () => (await robots(ANNA) as Array<RobotSummary>).find((robot) => robot.id === id)!
    await api(ANNA, `/api/robots/${id}/conversation`)
    expect(await entry()).toMatchObject({ unread: false, pinned: false, hidden: false })
    await api(ANNA, `/api/robots/${id}/list`, { body: { pinned: true, hidden: true, unread: true } })
    expect(await entry()).toMatchObject({ unread: true, pinned: true, hidden: true })
    await api(ANNA, `/api/robots/${id}/conversation`)
    expect((await entry()).unread).toBe(false)
    scripts.set(id, [{ text: 'Something new.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'any news?' } })
    await settle(id)
    expect((await entry()).unread).toBe(true)
  })

  it('shows a failed Turn as a blocked state with a plain line, never the raw error', async () => {
    const id = await activeRobot()
    await env.ROBOT.getByName(id).updateSettings({ model: { provider: 'deepseek', model: 'deepseek-flash', effort: 'high' } })
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    const entry = (await robots(ANNA) as Array<RobotSummary>).find((robot) => robot.id === id)!
    expect(entry.fleetState).toBe('blocked')
    expect(entry.lastLine).toBe('Could not finish its last task. Open to see why.')
  })
})
