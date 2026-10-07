import { reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, Me } from '@mr-robot/protocol'
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

async function robotWith(tools: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [], hosts: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

describe('conversation: streaming and Work details (v1.3 ticket 03)', () => {
  it('pushes the reply text over the live socket while it is produced (pl-jzr7)', async () => {
    const id = await robotWith([])
    const response = await SELF.fetch(`https://mr-robot.test/api/robots/${id}/ws`, { headers: { upgrade: 'websocket', 'x-dev-identity': ANNA } })
    const socket = response.webSocket!
    socket.accept()
    const frames: Array<{ type?: string; text?: string; done?: boolean }> = []
    socket.addEventListener('message', (event) => { if (typeof event.data === 'string' && event.data !== 'pong') frames.push(JSON.parse(event.data)) })
    scripts.set(id, [{ text: 'A **streamed** answer.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await settle(id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    socket.close()
    expect(frames.some((frame) => frame.type === 'stream' && frame.text === 'A **streamed** answer.')).toBe(true)
    expect(frames.some((frame) => frame.type === 'stream' && frame.done === true)).toBe(true)
  })

  it('returns tool calls with arguments and results only when details are asked for; the setting is per Member (pl-6eir)', async () => {
    const id = await robotWith(['files'])
    scripts.set(id, [{ calls: [{ name: 'write', args: { file_path: 'notes.md', content: 'hello' } }] }, { text: 'Written.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'write it' } })
    await settle(id)
    const compact = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.find((item) => item.kind === 'activity')
    expect(compact?.kind === 'activity' && compact.calls).toBeUndefined()
    const detailed = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation?details=1`)).body.items.find((item) => item.kind === 'activity')
    expect(detailed?.kind === 'activity' && detailed.calls?.[0]).toMatchObject({ name: 'write', error: false })
    expect(detailed?.kind === 'activity' && detailed.calls?.[0]?.args).toContain('notes.md')

    expect((await api<Me>(ANNA, '/api/me')).body.workDetails).toBe('compact')
    await api(ANNA, '/api/me', { method: 'PATCH', body: { workDetails: 'detailed' } })
    expect((await api<Me>(ANNA, '/api/me')).body.workDetails).toBe('detailed')
  })
})
