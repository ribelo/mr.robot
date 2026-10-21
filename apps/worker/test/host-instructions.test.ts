/**
 * The Workspace's instructions and skills (v1.21 ticket 04): the chain as its own platform message after the memory, refreshed on a cd and
 * on a deeper read, changed and removed files, digests that keep a Turn's start cheap, the budget, and the Host's skills in the catalog
 * with the code's precedence. Driven through the edge API with the scripted model and the fake Host app; DSH's own loader, the overlays,
 * the duplicates and the links are run on real files by the app's tests (apps/host/test/workspace-context.test.ts).
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { INSTRUCTIONS_MAX_BYTES } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, contextCalls, fakeHost, hostDirectories, hostDisk, linkedRoots } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const REPO = '/home/anna/repo'
const put = (path: string, text: string) => hostDisk.set(path, new TextEncoder().encode(text))

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  hostDirectories.add(`${REPO}/.git`)
  put('/home/anna/.agents/AGENTS.md', 'SHARED AGENTS RULE')
  put(`${REPO}/AGENTS.md`, 'ROOT RULE')
  put(`${REPO}/CLAUDE.md`, 'ROOT RULE\n')
  put(`${REPO}/AGENTS.local.md`, 'LOCAL OVERLAY')
  put(`${REPO}/app/AGENTS.md`, 'APP RULE')
  put(`${REPO}/app/CLAUDE.md`, 'LINKED SECRET')
  linkedRoots.add(`${REPO}/app/CLAUDE.md`)
  put(`${REPO}/app/lib/AGENTS.md`, 'LIB RULE')
  put(`${REPO}/app/lib/x.ts`, 'export {}')
})

afterEach(closeHosts)

async function coder(host: { hostId: string }, grants: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow', ...grants }, hosts: { [`${host.hostId}:files`]: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  expect((await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { workspace: { host: host.hostId, root: REPO } } })).status).toBe(200)
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
async function turn(id: string, calls: Call[] = []): Promise<GenerateOptions[]> {
  const before = requests.get(id)?.length ?? 0
  scripts.set(id, [...calls.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.slice(before)
}
/** The Workspace instruction messages a request carries, by form. */
const instructions = (request: GenerateOptions | undefined): Array<{ form: string; text: string }> => (request?.messages ?? []).flatMap((message) => {
  const form = (message as { source?: { workspaceInstructions?: string } }).source?.workspaceInstructions
  return form === undefined || message.role !== 'user' ? [] : [{ form, text: message.content.map((block) => ('text' in block ? block.text : '')).join('') }]
})
/** The instruction messages a request of a Turn carries that the request before it did not. */
const added = (turnRequests: GenerateOptions[], index: number, before: GenerateOptions | undefined) => instructions(turnRequests[index]).slice(instructions(index === 0 ? before : turnRequests[index - 1]).length)
const lastNew = (turnRequests: GenerateOptions[], index: number) => added(turnRequests, index, undefined).at(-1)

describe('the chain as its own message (cw-ec6f, cw-hm3d, cw-jc3f)', () => {
  it('comes after the memory: the global file, the root with its overlay, a duplicate once, nothing below the current directory', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    const [first] = await turn(id)
    const messages = first!.messages
    const chain = messages.findIndex((message) => (message as { source?: { workspaceInstructions?: string } }).source?.workspaceInstructions === 'baseline')
    // Right after the Wake-up, or after the memory message that follows it.
    const previous = messages[chain - 1] as unknown as { source?: { memory?: string }; role: string; content: ReadonlyArray<{ text?: string }> }
    expect(previous.source?.memory !== undefined || (previous.role === 'user' && JSON.stringify(previous.content).includes('go'))).toBe(true)
    const text = instructions(first)[0]!.text
    expect(text).toContain('Workspace instructions: the AGENTS.md chain of your Workspace on Desk (repository /home/anna/repo, current directory /home/anna/repo)')
    expect(text.indexOf('SHARED AGENTS RULE')).toBeLessThan(text.indexOf('ROOT RULE'))
    expect(text.indexOf('ROOT RULE')).toBeLessThan(text.indexOf('LOCAL OVERLAY'))
    expect(text.split('ROOT RULE').length - 1).toBe(1)
    expect(text).not.toContain('APP RULE')
    // The prompt holds none of it.
    expect(JSON.stringify(first!.system ?? '')).not.toContain('ROOT RULE')
  })

  it('is given again for a new directory after a cd, without a file reached through a link, and grows with a deeper read', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    await turn(id)
    const moved = await turn(id, [{ name: 'working_directory', args: { cd: 'app' } }])
    const after = lastNew(moved, 1)!
    expect(after.form).toBe('baseline')
    expect(after.text).toContain('APP RULE')
    expect(after.text).not.toContain('LINKED SECRET')
    const deeper = await turn(id, [{ name: 'read', args: { on: 'workspace', file_path: 'lib/x.ts' } }])
    const grown = lastNew(deeper, 1)!
    expect(grown.form).toBe('changes')
    expect(grown.text).toContain('Instructions from: app/lib/AGENTS.md (new)')
    expect(grown.text).toContain('LIB RULE')
  })

  it('says a changed file with its new text and a removed one with a notice; a Turn with nothing changed gets nothing and resends nothing', async () => {
    const desk = await fakeHost('Desk')
    const id = await coder(desk)
    const opening = await turn(id)
    contextCalls.length = 0
    const quiet = await turn(id)
    expect(added(quiet, 0, opening.at(-1))).toEqual([])
    // Each run of the agent in the Turn asks once, with what it holds (the Turn and its safety-net step here): digests only.
    expect(contextCalls.length).toBeGreaterThan(0)
    expect(contextCalls.every((call) => call.rpc === 'WorkspaceState' && call.known && call.cwd === REPO)).toBe(true)
    put(`${REPO}/AGENTS.md`, 'ROOT RULE, SECOND EDITION')
    hostDisk.delete(`${REPO}/AGENTS.local.md`)
    const changed = added(await turn(id), 0, quiet.at(-1)).at(-1)!
    expect(changed.form).toBe('changes')
    expect(changed.text).toContain('Instructions from: AGENTS.md (changed; this replaces the earlier text)\n\nROOT RULE, SECOND EDITION')
    expect(changed.text).toContain('AGENTS.local.md was removed: its instructions no longer apply.')
    expect(changed.text).not.toContain('SHARED AGENTS RULE')
  })

  it('keeps the chain within its budget', async () => {
    const desk = await fakeHost('Desk')
    put(`${REPO}/AGENTS.local.md`, 'x'.repeat(INSTRUCTIONS_MAX_BYTES + 5_000))
    const id = await coder(desk)
    const text = instructions((await turn(id))[0])[0]!.text
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_BYTES)
  })
})

describe('the Host skills in the catalog (cw-s2rt)', () => {
  it('lists the home and repository skills; a platform skill keeps its name and notes the one it shadows; a Host skill loads', async () => {
    const desk = await fakeHost('Desk')
    put('/home/anna/.agents/skills/release/SKILL.md', '---\nname: release\ndescription: How the owner releases.\n---\nRelease body.')
    put(`${REPO}/.agents/skills/migrate/SKILL.md`, '---\nname: migrate\ndescription: Database migrations here.\n---\nMigrate body.')
    put(`${REPO}/.agents/skills/hosts/SKILL.md`, '---\nname: hosts\ndescription: The repository says hosts are mine.\n---\nShadowed body.')
    const id = await coder(desk)
    const requests_ = await turn(id, [{ name: 'skill', args: { name: 'migrate' } }, { name: 'skill', args: { name: 'hosts' } }])
    const seen = JSON.stringify(requests_[0]!.messages)
    expect(seen).toContain('- `release`: How the owner releases.')
    expect(seen).toContain('- `migrate`: Database migrations here.')
    expect(seen).toMatch(/- `hosts`: [^"]*\(also: Desk repository skill of the same name, shadowed\)/)
    expect(seen).not.toContain('The repository says hosts are mine.')
    const results = JSON.stringify(requests_.at(-1)!.messages.filter((message) => message.role === 'tool'))
    expect(results).toContain('Migrate body.')
    expect(results).not.toContain('Shadowed body.')
  })
})
