/**
 * The lsp tool (v1.21 ticket 06, cw-lx4f, cw-xxqw): the four operations on "workspace" only, one-based for the Robot and zero-based on the
 * wire, locations with paths from the repository root. The servers themselves, their start and stop, are the app's tests'
 * (apps/host/test/lsp.test.ts).
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories, lspCalls } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const REPO = '/home/anna/repo'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  hostDirectories.add(`${REPO}/.git`)
  hostDirectories.add(`${REPO}/src`)
})

afterEach(closeHosts)

type Call = { name: string; args: Record<string, unknown> }
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-list.length).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

async function coder(host: { hostId: string }, workspace: boolean): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' }, hosts: { [`${host.hostId}:files`]: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  if (workspace) await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { workspace: { host: host.hostId, root: REPO } } })
  requests.delete(body.id)
  return body.id
}

describe('lsp (cw-lx4f, cw-xxqw)', () => {
  it('asks the four operations on the Workspace, one-based to the Robot, paths from the repository root', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk, true)
    const at = { on: 'workspace', file_path: 'src/b.ts', line: 3, character: 2 }
    const answers = await calls(id, [
      { name: 'lsp', args: { ...at, operation: 'goToDefinition' } },
      { name: 'lsp', args: { ...at, operation: 'findReferences' } },
      { name: 'lsp', args: { ...at, operation: 'goToImplementation' } },
      { name: 'lsp', args: { ...at, operation: 'hover' } },
    ])
    expect(lspCalls.map((call) => call.operation)).toEqual(['goToDefinition', 'findReferences', 'goToImplementation', 'hover'])
    expect(lspCalls[0]).toEqual({ operation: 'goToDefinition', file: 'src/b.ts', line: 2, character: 1, cwd: REPO })
    expect(JSON.parse(answers[0]!)).toEqual({ kind: 'locations', locations: [{ path: 'src/b.ts', line: 3, character: 2, endLine: 3, endCharacter: 7 }] })
    expect(JSON.parse(answers[3]!)).toEqual({ kind: 'hover', contents: 'function greet(name: string): string' })
  })

  it('refuses another place, and a Robot without a Workspace has no lsp tool', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk, true)
    const [elsewhere] = await calls(id, [{ name: 'lsp', args: { on: 'Desk', operation: 'hover', file_path: 'a.ts', line: 1, character: 1 } }])
    expect(elsewhere).toContain('language servers work on your Workspace only (on "workspace")')
    expect(lspCalls).toEqual([])
    const plain = await coder(desk, false)
    await calls(plain, [])
    expect(requests.get(plain)!.at(-1)!.tools!.map((tool) => tool.name)).not.toContain('lsp')
  })
})
