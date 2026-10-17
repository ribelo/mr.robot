import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

describe('the Wake-up queue', () => {
  it('two Wake-ups arriving together run as two Turns, never interleaved (robot-makt)', async () => {
    const id = await activeRobot([])
    scripts.set(id, [{ text: 'one' }, { text: 'two' }])
    await Promise.all([
      api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'first' } }),
      api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'second' } }),
    ])
    await settle(id)
    const events = await env.ROBOT.getByName(id).trajectory()
    // Each Turn is the span from turn/start to its turn/end; nothing of another Turn falls inside.
    const turns: string[][] = []
    let open: string[] | undefined
    for (const event of events) {
      if (event.type === 'turn/start') {
        expect(open).toBeUndefined()
        open = []
      }
      open?.push(event.type)
      if (event.type === 'turn/end') {
        turns.push(open!)
        open = undefined
      }
    }
    const own = turns.slice(-2)
    expect(own).toHaveLength(2)
    for (const turn of own) {
      expect(turn.filter((type) => type === 'turn/start')).toHaveLength(1)
      expect(turn.at(-1)).toBe('turn/end')
      expect(turn.filter((type) => type === 'user/message')).toHaveLength(1)
    }
  })
})
