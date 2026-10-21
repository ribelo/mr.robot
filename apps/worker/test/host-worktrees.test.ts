/**
 * Worktrees (v1.21 ticket 05, cw-11je, cw-zuyu): create_worktree through the fake Host app, the four fields, the Robot's directory moved
 * there and kept, the worktree in every later call's access (the app makes the worktree and .git the write roots, apps/host/test/
 * worktrees.test.ts), one per Robot, none for a Subagent.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RobotSettings } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostDirectories, hostDisk, hostFileCalls, worktreesMade } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const REPO = '/home/anna/repo'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  hostFileCalls.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
  hostDirectories.add(`${REPO}/.git`)
  hostDisk.set(`${REPO}/src/a.ts`, new TextEncoder().encode('export {}'))
})

afterEach(closeHosts)

async function coder(host: { hostId: string }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow', subagents: 'allow' }, hosts: { [`${host.hostId}:files`]: 'allow' } }, subagentModels: [{ provider: 'stub', model: 'stub' }] } })
  await testRobot(body.id).activateForTest()
  expect((await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { workspace: { host: host.hostId, root: REPO } } })).status).toBe(200)
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
const toolTexts = (id: string, count: number) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-count).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return toolTexts(id, list.length)
}

describe('create_worktree (cw-11je, cw-zuyu)', () => {
  it('answers path, branch, baseCommit and repositoryRoot, moves the Robot there for good, and puts the worktree in every later call', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    const [created, where] = await calls(id, [{ name: 'create_worktree', args: {} }, { name: 'working_directory', args: {} }])
    const body = JSON.parse(created!) as { path: string; branch: string; baseCommit: string; repositoryRoot: string }
    expect(body).toEqual({ path: expect.stringMatching(/^\/home\/anna\/repo\/\.agents\/worktrees\/.+/), branch: expect.any(String), baseCommit: expect.stringMatching(/^[0-9a-f]{40}$/), repositoryRoot: REPO })
    expect(body.path).toBe(`${REPO}/.agents/worktrees/${body.branch}`)
    expect(JSON.parse(where!)).toMatchObject({ cwd: body.path })
    const settings = (await api<{ settings: RobotSettings }>(ANNA, `/api/robots/${id}/panel`)).body.settings
    expect(settings.workspace).toMatchObject({ root: REPO, repository: REPO, worktree: body.path })
    // The next Turn reads from the worktree, and the app gets the worktree for its write roots.
    await calls(id, [{ name: 'read', args: { on: 'workspace', file_path: 'src/a.ts' } }])
    expect(hostFileCalls.at(-1)).toMatchObject({ rpc: 'Read', path: `${body.path}/src/a.ts`, access: { cwd: body.path, workspace: { root: REPO, repository: REPO, worktree: body.path } } })
    const [again] = await calls(id, [{ name: 'create_worktree', args: {} }])
    expect(again).toContain('you have a worktree already')
    expect(worktreesMade).toHaveLength(1)
  })

  it('is refused to a Subagent', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    scripts.set(`${id}:sub`, [{ calls: [{ name: 'create_worktree', args: {} }] }, { text: 'REPORT: no worktree.' }])
    scripts.set(id, [{ calls: [{ name: 'subagent', args: { description: 'Try', prompt: 'Make a worktree' } }] }, { text: 'Started.' }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
    await vi.waitFor(async () => {
      await settle(id)
      const child = requests.get(`${id}:sub`)?.at(-1)
      expect(JSON.stringify(child?.messages ?? [])).toContain('a Subagent works in its Robot')
    }, { timeout: 15_000 })
    expect(worktreesMade).toEqual([])
  })
})
