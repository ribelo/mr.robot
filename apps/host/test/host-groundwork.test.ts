/**
 * The Host groundwork of v1.21 (ticket 01): the environment commands get (the login environment, scrubbed as DSH scrubs, with the
 * config's allow-list; cw-et7q), the sandbox policy built from the grant with the Workspace's roots (cw-o4fr, cw-zuyu) and the Workspace
 * sessions' lifecycle (cw-p4bm). Driven through the Host protocol over real files and the machine's real sandbox, as the Worker drives the
 * app; the test directory is in the home directory, not in /tmp, which a confined process may write.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HostAccess } from '@mr-robot/host-protocol'
import { writeRoots } from '../src/access.ts'
import { captureLoginEnvironment, commandEnvironment, DEFAULT_ENVIRONMENT } from '../src/environment.ts'
import { access, connected, jobName } from './connected.ts'

let home = ''
let host: Awaited<ReturnType<typeof connected>>
/** What the login shell gives, as the test says it: changed by a test to see a refresh. */
let login: Record<string, string> = {}
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const failure = (name: string, payload: unknown) => Effect.runPromise(Effect.flip(host.rpc[name]!(payload))) as Promise<{ message: string; code?: string }>
const stdout = async (command: string, change: Partial<HostAccess> = {}) => ((await call('Run', { command, background: false, job: jobName(), access: access(change) })) as { stdout: { text: string } }).stdout.text

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-groundwork-'))
  login = { PATH: process.env['PATH'] ?? '', HOME: home, PROJECT_FLAG: 'from-profile', GITHUB_TOKEN: 'ghp-secret', GIT_ACCESS_TOKEN: 'git-secret', DSH_SESSION: 'harness', PWD: '/somewhere' }
  host = await connected(home, undefined, { capture: async () => ({ ...login }), environment: { allow: ['SSH_AUTH_SOCK', 'GIT_*'], set: { SSH_AUTH_SOCK: '/run/agent.sock' } } })
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('the environment of a command (cw-et7q, cw-dkkw)', () => {
  it('is the login environment without credential-shaped names, except those the allow-list keeps, with the configured values', async () => {
    const printed = await stdout('echo "$PROJECT_FLAG|$GITHUB_TOKEN|$GIT_ACCESS_TOKEN|$DSH_SESSION|$SSH_AUTH_SOCK"', { mode: 'full' })
    expect(printed.trim()).toBe('from-profile||git-secret||/run/agent.sock')
  })

  it('is captured again on a refresh (a new pairing)', async () => {
    login = { ...login, PROJECT_FLAG: 'changed' }
    await host.shell.refreshEnvironment()
    expect((await stdout('echo "$PROJECT_FLAG"', { mode: 'full' })).trim()).toBe('changed')
  })

  it('drops the state of the shell that printed it, and takes a real login shell\'s environment', async () => {
    expect(commandEnvironment({ PWD: '/x', SHLVL: '2', _: '/bin/env', OLDPWD: '/y', API_KEY: 'k', LANG: 'C' }, DEFAULT_ENVIRONMENT)).toEqual({ LANG: 'C' })
    const real = await captureLoginEnvironment()
    expect(real?.['PATH']).toBeTruthy()
  })
})

describe('the policy from the grant and the Workspace (cw-o4fr, cw-zuyu)', () => {
  it('adds the root and the repository\'s .git, or the worktree and .git without the main working tree, covering what lies inside', () => {
    const base = { robot: 'bot', mode: 'workspace-write' as const, roots: [] }
    expect(writeRoots('/h', { ...base, workspace: { root: '/h/repo', repository: '/h/repo' } })).toEqual(['/h/mr-robot/bot', '/h/repo'])
    expect(writeRoots('/h', { ...base, workspace: { root: '/h/repo/app', repository: '/h/repo' } })).toEqual(['/h/mr-robot/bot', '/h/repo/app', '/h/repo/.git'])
    expect(writeRoots('/h', { ...base, workspace: { root: '/h/repo', repository: '/h/repo', worktree: '/h/repo/.agents/worktrees/bot' } })).toEqual(['/h/mr-robot/bot', '/h/repo/.agents/worktrees/bot', '/h/repo/.git'])
    expect(writeRoots('/h', { ...base, roots: ['/h/repo/out', '/srv'], workspace: { root: '/h/repo', repository: '/h/repo' } })).toEqual(['/h/mr-robot/bot', '/srv', '/h/repo'])
    expect(writeRoots('/h', { ...base, roots: ['/h'], workspace: { root: '/h/repo', repository: '/h/repo' } })).toEqual(['/h/mr-robot/bot', '/h'])
  })

  it('lets a confined write change the Workspace, and a worktree but not the main working tree', async () => {
    const repo = join(home, 'repo')
    const worktree = join(repo, '.agents', 'worktrees', 'bot')
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(worktree, { recursive: true })
    const workspace = { root: repo, repository: repo }
    expect((await call('Write', { path: join(repo, 'src', 'a.ts'), text: 'a', access: access({ workspace }) })).bytes).toBe(1)
    expect(await readFile(join(repo, 'src', 'a.ts'), 'utf8')).toBe('a')
    const outside = await failure('Write', { path: join(home, 'other', 'b.ts'), text: 'b', access: access({ workspace }) })
    expect(outside.code).toBe('SANDBOX_DENIED')
    const isolated = { ...workspace, worktree }
    expect((await failure('Write', { path: join(repo, 'src', 'c.ts'), text: 'c', access: access({ workspace: isolated }) })).code).toBe('SANDBOX_DENIED')
    await call('Write', { path: join(worktree, 'c.ts'), text: 'c', access: access({ workspace: isolated }) })
    await call('Write', { path: join(repo, '.git', 'HEAD'), text: 'ref: refs/heads/bot', access: access({ workspace: isolated }) })
    expect((await stdout(`cat ${join(worktree, 'c.ts')} && touch ${join(repo, 'src', 'd.ts')}; echo $?`, { workspace: isolated })).trim().split('\n').at(-1)).not.toBe('0')
  })
})

describe('the Workspace sessions (cw-p4bm)', () => {
  const repo = () => join(home, 'session-repo')
  const other = () => join(home, 'other-repo')

  it('open on the first call with a Workspace and close when it changes, on WorkspaceClose, and all at once (unpair, quit)', async () => {
    await mkdir(join(repo(), '.git'), { recursive: true })
    await mkdir(join(other(), '.git'), { recursive: true })
    await writeFile(join(repo(), 'README.md'), 'hi')
    await host.shell.sessions.closeAll()
    const closed: string[] = []
    expect(host.shell.sessions.get('bot')).toBeUndefined()
    await call('Read', { path: join(repo(), 'README.md'), access: access() })
    expect(host.shell.sessions.get('bot')).toBeUndefined()

    await call('Read', { path: join(repo(), 'README.md'), access: access({ workspace: { root: repo(), repository: repo() } }) })
    const first = host.shell.sessions.get('bot')!
    first.onClose(() => { closed.push('first') })
    await stdout('true', { workspace: { root: repo(), repository: repo() } })
    expect(host.shell.sessions.get('bot')).toBe(first)

    await call('Read', { path: join(other(), '.git'), access: access({ workspace: { root: other(), repository: other() } }) }).catch(() => undefined)
    expect(closed).toEqual(['first'])
    const second = host.shell.sessions.get('bot')!
    second.onClose(() => { closed.push('second') })
    await call('WorkspaceClose', { robot: 'bot' })
    expect(closed).toEqual(['first', 'second'])
    expect(host.shell.sessions.get('bot')).toBeUndefined()
    await call('WorkspaceClose', { robot: 'bot' })

    await stdout('true', { robot: 'one', workspace: { root: repo(), repository: repo() } })
    await stdout('true', { robot: 'two', workspace: { root: repo(), repository: repo() } })
    host.shell.sessions.get('one')!.onClose(() => { closed.push('one') })
    host.shell.sessions.get('two')!.onClose(() => { closed.push('two') })
    await host.shell.sessions.closeAll()
    expect(closed.slice(2).sort()).toEqual(['one', 'two'])
  })
})
