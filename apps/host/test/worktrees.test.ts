/**
 * A Robot's worktree (v1.21 ticket 05, cw-11je, cw-zuyu): DSH's worktree runtime on a real repository, through the Host protocol. The
 * checkout holds the committed content only, under <repository>/.agents/worktrees/<robot>; with it, the Robot's writes reach the worktree
 * and the repository's .git, not the main working tree.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { access, connected, jobName } from './connected.ts'

let home = ''
let repo = ''
let host: Awaited<ReturnType<typeof connected>>
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const failure = (name: string, payload: unknown) => Effect.runPromise(Effect.flip(host.rpc[name]!(payload))) as Promise<{ message: string; code?: string }>
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repo, encoding: 'utf8' }).trim()

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-worktrees-'))
  repo = join(home, 'repo')
  await mkdir(join(repo, 'src'), { recursive: true })
  git('init', '-q', '-b', 'main')
  await writeFile(join(repo, 'src', 'a.ts'), 'committed')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  await writeFile(join(repo, 'untracked.txt'), 'not committed')
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('create a worktree (cw-11je, cw-zuyu)', () => {
  it('makes branch and checkout from the current commit, committed content only, and the write roots isolate it', async () => {
    const workspace = { root: repo, repository: repo }
    const created = await call('CreateWorktree', { access: access({ workspace, cwd: join(repo, 'src') }) })
    const path = join(repo, '.agents', 'worktrees', 'bot')
    expect(created).toEqual({ path, branch: 'bot', baseCommit: git('rev-parse', 'HEAD'), repositoryRoot: repo })
    expect(await readFile(join(path, 'src', 'a.ts'), 'utf8')).toBe('committed')
    await expect(stat(join(path, 'untracked.txt'))).rejects.toThrow()
    // With the worktree the Robot changes its checkout and git's data, not the main working tree.
    const isolated = { ...workspace, worktree: path }
    await call('Write', { path: join(path, 'src', 'b.ts'), text: 'mine', access: access({ workspace: isolated, cwd: path }) })
    expect((await failure('Write', { path: join(repo, 'src', 'c.ts'), text: 'no', access: access({ workspace: isolated, cwd: path }) })).code).toBe('SANDBOX_DENIED')
    const committed = await call('Run', { command: 'git add -A && git -c user.name=Bot -c user.email=bot@example.com commit -q -m "from the worktree" && git log --oneline -1', background: false, job: jobName(), access: access({ workspace: isolated, cwd: path }) })
    expect(committed).toMatchObject({ kind: 'foreground', exitCode: 0 })
    expect(git('log', '--oneline', '-1', 'bot')).toContain('from the worktree')
    // One worktree per Robot.
    expect((await failure('CreateWorktree', { access: access({ workspace: isolated, cwd: path }) })).code).toBe('EEXIST')
  })
})
