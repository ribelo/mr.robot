/**
 * The owner's Workspace panel on this computer (v1.21 ticket 08, cw-1wrt): the files of the checkout and git's state, read through the
 * Host protocol. git runs with the repository's programs off: a repository whose config names a file-system monitor, a pager and hooks
 * that would write a marker gets none of them run.
 */
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { access, connected } from './connected.ts'

let home = ''
let repo = ''
let host: Awaited<ReturnType<typeof connected>>
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo, encoding: 'utf8' })

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-panel-'))
  repo = join(home, 'repo')
  await mkdir(join(repo, 'src'), { recursive: true })
  git('init', '-q', '-b', 'main')
  await writeFile(join(repo, 'src', 'a.ts'), 'one')
  git('add', '.')
  git('commit', '-q', '-m', 'first commit')
  await writeFile(join(repo, 'src', 'a.ts'), 'changed')
  await writeFile(join(repo, 'new.txt'), 'untracked')
  // A repository that would run programs of its own on status: a monitor and a pager writing a marker.
  const marker = join(home, 'ran')
  const program = join(home, 'evil.sh')
  await writeFile(program, `#!/bin/sh\ntouch ${marker}\n`)
  await chmod(program, 0o755)
  git('config', 'core.fsmonitor', program)
  git('config', 'core.pager', program)
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('the Workspace panel (cw-1wrt)', () => {
  it('reads the branch, the status and the log with the repository\'s programs off', async () => {
    const workspace = access({ workspace: { root: repo, repository: repo } })
    const state = await call('GitState', { access: workspace })
    expect(state.branch).toBe('main')
    expect(state.status).toEqual([{ code: ' M', path: 'src/a.ts' }, { code: '??', path: 'new.txt' }])
    expect(state.log).toHaveLength(1)
    expect(state.log[0]).toMatchObject({ subject: 'first commit', author: 'Test' })
    await expect(stat(join(home, 'ran'))).rejects.toThrow()
  })

  it('lists a directory of the checkout, directories first, without .git, and nothing outside it', async () => {
    const workspace = access({ workspace: { root: repo, repository: repo } })
    const root = await call('WorkspaceFiles', { path: '', access: workspace })
    expect(root.entries.map((entry: { name: string; kind: string }) => `${entry.kind}:${entry.name}`)).toEqual(['directory:src', 'file:new.txt'])
    expect((await call('WorkspaceFiles', { path: 'src', access: workspace })).entries).toEqual([{ name: 'a.ts', kind: 'file', size: 7 }])
    await expect(call('WorkspaceFiles', { path: '..', access: workspace })).rejects.toBeDefined()
  })
})
