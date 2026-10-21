/**
 * The Workspace's instructions and skills on this computer (v1.21 ticket 04): DSH's own instruction loader and skill provider over a real
 * repository, home and skills tree, driven through the Host protocol as the Worker drives the app. The chain is confined to the
 * repository (cw-jc3f), follows the current directory and the touched directories (cw-hm3d), and resends nothing the Worker holds (cw-rkud).
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { instructionChain } from '../src/workspace-context.ts'
import { access, connected } from './connected.ts'

let home = ''
let repo = ''
let host: Awaited<ReturnType<typeof connected>>
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const at = (cwd: string) => access({ workspace: { root: repo, repository: repo }, cwd })

beforeAll(async () => {
  // The homes are DSH's process policy: the environment first. This test's home is a directory of its own.
  delete process.env['DSH_HOME']
  delete process.env['DSH_AGENTS_HOME']
  home = await mkdtemp(join(homedir(), '.mr-robot-host-context-'))
  repo = join(home, 'repo')
  await mkdir(join(repo, '.git'), { recursive: true })
  await mkdir(join(repo, 'app', 'lib'), { recursive: true })
  await mkdir(join(home, '.agents', 'skills', 'release'), { recursive: true })
  await mkdir(join(home, '.dsh'), { recursive: true })
  await mkdir(join(repo, '.agents', 'skills', 'migrate'), { recursive: true })
  await writeFile(join(home, '.dsh', 'AGENTS.md'), 'HARNESS HOME RULE')
  await writeFile(join(home, '.agents', 'AGENTS.md'), 'SHARED AGENTS RULE')
  await writeFile(join(repo, 'AGENTS.md'), 'ROOT RULE')
  await writeFile(join(repo, 'CLAUDE.md'), 'ROOT RULE\n')
  await writeFile(join(repo, 'AGENTS.local.md'), 'LOCAL OVERLAY')
  await writeFile(join(repo, 'app', 'AGENTS.md'), 'APP RULE')
  await writeFile(join(repo, 'app', 'lib', 'AGENTS.md'), 'LIB RULE')
  await writeFile(join(repo, 'app', 'lib', 'x.ts'), 'export {}')
  await writeFile(join(home, 'secret.txt'), 'PRIVATE KEY MATERIAL')
  await symlink(join(home, 'secret.txt'), join(repo, 'app', 'CLAUDE.md'))
  await writeFile(join(home, '.agents', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: How the owner releases.\n---\nRelease body.')
  await writeFile(join(repo, '.agents', 'skills', 'migrate', 'SKILL.md'), '---\nname: migrate\ndescription: Database migrations here.\n---\nMigrate body.')
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('the instruction chain (cw-ec6f, cw-jc3f)', () => {
  it('renders the global files, then the repository root down to the current directory with the overlays, duplicates once, nothing through a link out of the repository', async () => {
    const opened = await call('WorkspaceOpen', { access: at(join(repo, 'app')), known: null, skillsDigest: null })
    const text: string = opened.rendered
    const order = ['HARNESS HOME RULE', 'SHARED AGENTS RULE', 'ROOT RULE', 'LOCAL OVERLAY', 'APP RULE'].map((rule) => text.indexOf(rule))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text.split('ROOT RULE').length - 1).toBe(1)
    expect(text).not.toContain('PRIVATE KEY MATERIAL')
    expect(text).not.toContain('LIB RULE')
    expect(opened.files.map((file: { path: string }) => file.path)).not.toContain(join(repo, 'app', 'CLAUDE.md'))
    expect(opened.nested).toBe(0)
  })

  it('keeps the rendered chain within its budget, the most specific rule last to go', async () => {
    const chain = await instructionChain({ home, repository: repo, cwd: join(repo, 'app'), touched: [], maxBytes: 400 })
    expect(new TextEncoder().encode(chain.rendered).length).toBeLessThanOrEqual(400)
    expect(chain.rendered).toContain('APP RULE')
  })

  it('adds the instruction files of a directory a read touched, and sends only what the Worker does not hold', async () => {
    const first = await call('WorkspaceState', { access: at(join(repo, 'app')), known: {}, skillsDigest: null })
    const known = Object.fromEntries(first.files.map((file: { path: string; digest: string }) => [file.path, file.digest]))
    await call('Read', { path: 'lib/x.ts', access: at(join(repo, 'app')) })
    const after = await call('WorkspaceState', { access: at(join(repo, 'app')), known, skillsDigest: first.skills.digest })
    expect(after.digest).not.toBe(first.digest)
    expect(after.nested).toBe(1)
    const lib = after.files.at(-1)
    expect(lib).toMatchObject({ path: join(repo, 'app', 'lib', 'AGENTS.md'), content: 'LIB RULE' })
    expect(after.files.filter((file: { content: string | null }) => file.content !== null)).toHaveLength(1)
    expect(after.rendered).toBeNull()
    expect(after.skills.entries).toBeNull()
  })
})

describe('the Host skills (cw-s2rt)', () => {
  it('lists the home and the repository skills with their scope and loads a body', async () => {
    const opened = await call('WorkspaceOpen', { access: at(repo), known: null, skillsDigest: null })
    expect(opened.skills.entries).toEqual([
      { name: 'migrate', description: 'Database migrations here.', scope: 'repository' },
      { name: 'release', description: 'How the owner releases.', scope: 'home' },
    ])
    expect((await call('SkillLoad', { name: 'migrate', access: at(repo) })).content).toContain('Migrate body.')
  })
})
