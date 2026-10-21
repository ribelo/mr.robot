/**
 * A Robot's Workspace on a Host (v1.21): the protocol version the app reports and the Workspace RPCs the Worker refuses to an older app
 * (cw-jn59), and the picker's listing (cw-gx04). Driven through the edge API with the fake Host app.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories } from './fake-host.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotWith(host: { hostId: string }, files: 'allow' | 'none' = 'allow'): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: {}, hosts: files === 'none' ? {} : { [`${host.hostId}:files`]: files } } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

const directories = (id: string, host: string, path: string) => api<{ path: string; directories: string[]; truncated: boolean; error?: string }>(ANNA, `/api/robots/${id}/hosts/${host}/directories?path=${encodeURIComponent(path)}`)

describe('the Host protocol version (cw-jn59)', () => {
  it('refuses a Workspace call to an app older than the Worker with one sentence naming the update, and sends it to a current one', async () => {
    const old = await fakeHost('Old desk', { protocolVersion: 1 })
    const legacy = await fakeHost('Attic', { legacy: true, sandbox: 'full' })
    const desk = await fakeHost('Desk')
    hostDirectories.add('/home/anna/projects/mr.robot/.git')
    hostDirectories.add('/home/anna/notes')
    for (const host of [old, legacy]) {
      const id = await robotWith(host)
      const refused = await directories(id, host.hostId, '~')
      expect(refused.status).toBe(409)
      const name = host === old ? 'Old desk' : 'Attic'
      expect(refused.body.error).toBe(`${name} runs an older Mr. Robot app than this server, so it cannot serve a Workspace: update the Mr. Robot app on ${name}.`)
    }
    const id = await robotWith(desk)
    const listed = await directories(id, desk.hostId, '~')
    expect(listed.status).toBe(200)
    expect(listed.body).toEqual({ path: '/home/anna', directories: ['notes', 'projects'], truncated: false })
    expect((await directories(id, desk.hostId, '~/projects/mr.robot')).body.directories).toEqual(['.git'])
  })

  it('lists only for a Robot that holds the files facet on the Host', async () => {
    const desk = await fakeHost('Desk')
    const id = await robotWith(desk, 'none')
    const refused = await directories(id, desk.hostId, '~')
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('has no files grant on the host "Desk"')
  })
})
