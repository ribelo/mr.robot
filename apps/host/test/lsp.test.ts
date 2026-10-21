/**
 * Language servers on this computer (v1.21 ticket 06, cw-fb1q, cw-yeq1, cw-lx4f): lsp.yaml or the default set, filtered by the login
 * PATH; a Workspace's servers start on its first query and stop when its session closes or after the idle time. The query runs the real
 * typescript-language-server when this machine has it.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { configuredServers, DEFAULT_SERVERS, mountableServers } from '../src/lsp.ts'
import { access, connected } from './connected.ts'

let home = ''
let repo = ''
let host: Awaited<ReturnType<typeof connected>>
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const hasTypeScriptServer = (process.env['PATH'] ?? '').split(':').some((directory) => {
  try { return require('node:fs').statSync(join(directory, 'typescript-language-server')).isFile() } catch { return false }
})

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-lsp-'))
  repo = join(home, 'repo')
  await mkdir(join(repo, '.git'), { recursive: true })
  await writeFile(join(repo, 'tsconfig.json'), '{ "compilerOptions": { "strict": true }, "include": ["*.ts"] }')
  await writeFile(join(repo, 'a.ts'), 'export function greet(name: string): string {\n  return name\n}\n')
  await writeFile(join(repo, 'b.ts'), "import { greet } from './a'\n\ngreet('Anna')\n")
  host = await connected(home, undefined, { capture: async () => ({ ...process.env }) as Record<string, string>, configDirectory: home, lspIdleMs: 1_500 })
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('the configured servers (cw-fb1q)', () => {
  it('are lsp.yaml when it is there, the default set when not, and only those whose command is on the PATH', async () => {
    expect(Object.keys(configuredServers(join(home, 'nowhere')))).toEqual(Object.keys(DEFAULT_SERVERS))
    const found = (command: string) => (command === 'rust-analyzer' ? '/bin/rust-analyzer' : undefined)
    expect(mountableServers(DEFAULT_SERVERS, found, '/bin')).toEqual({ rust: { ...DEFAULT_SERVERS['rust'], command: '/bin/rust-analyzer', env: { PATH: '/bin' } } })
    await writeFile(join(home, 'lsp.yaml'), "servers:\n  mine:\n    command: my-server\n    args: ['--stdio']\n    extensionToLanguage:\n      '.foo': foo\n")
    expect(configuredServers(home)).toEqual({ mine: { command: 'my-server', args: ['--stdio'], extensionToLanguage: { '.foo': 'foo' } } })
    await rm(join(home, 'lsp.yaml'))
  })
})

describe.runIf(hasTypeScriptServer)('a Workspace\'s servers (cw-lx4f, cw-yeq1)', () => {
  const workspace = () => access({ workspace: { root: repo, repository: repo }, cwd: repo })

  it('start on the first query, answer it, and stop when the Workspace session closes', async () => {
    expect(host.shell.languageServers.sessions()).toEqual([])
    const found = await call('Lsp', { operation: 'findReferences', file: 'a.ts', line: 0, character: 17, access: workspace() })
    expect(found.kind).toBe('locations')
    // The declaration is always among the references (DSH's contract); other files depend on how far the server indexed.
    expect(found.locations.map((location: { uri: string }) => location.uri)).toContain(`file://${join(repo, 'a.ts')}`)
    expect(found.resolvedWorkspaceUri).toBe(`file://${repo}`)
    expect(host.shell.languageServers.sessions()).toHaveLength(1)
    await call('WorkspaceClose', { robot: 'bot' })
    expect(host.shell.languageServers.sessions()).toEqual([])
  }, 60_000)

  it('stop after the idle time without a query', async () => {
    const hover = await call('Lsp', { operation: 'hover', file: 'a.ts', line: 0, character: 17, access: workspace() })
    expect(hover.kind).toBe('hover')
    expect(hover.hover.contents).toContain('greet')
    expect(host.shell.languageServers.sessions()).toHaveLength(1)
    await vi.waitFor(() => expect(host.shell.languageServers.sessions()).toEqual([]), { timeout: 10_000, interval: 200 })
  }, 60_000)
})
