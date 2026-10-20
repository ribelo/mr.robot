/**
 * A Robot's commands on this computer (v1.16 ticket 02, ob-wsf7): bash through DSH's sandbox, in the Robot's directory, under the mode and
 * roots of its grant. These run the real sandbox of the machine (bubblewrap or Landlock); where it has none, the same calls must fail closed.
 * The test directory is in the home directory and not in /tmp, because a confined command may write /tmp (bubblewrap gives it a private one).
 */
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { access, connected, jobName } from './connected.ts'
import { deniedPath } from '../src/shell.ts'

let home = ''
let host: Awaited<ReturnType<typeof connected>>
const run = (command: string, change: Parameters<typeof access>[0] = {}) => Effect.runPromise(host.rpc['Run']!({ command, background: false, job: jobName(), access: access(change) }))
const failure = (command: string, change: Parameters<typeof access>[0] = {}) => Effect.runPromise(Effect.flip(host.rpc['Run']!({ command, background: false, job: jobName(), access: access(change) }))) as Promise<{ message: string; code?: string }>

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-test-'))
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('a command in full mode', () => {
  it('runs in the Robot directory, made on first use, and writes anywhere', async () => {
    const outside = join(home, 'anywhere.txt')
    const result = await run(`pwd && echo full > ${outside}`, { mode: 'full' })
    expect(result).toMatchObject({ kind: 'foreground', exitCode: 0, timedOut: false, sandbox: { mode: 'full', denied: false } })
    expect(result.stdout.text.trim()).toBe(join(home, 'mr-robot', 'bot'))
    expect(await readFile(outside, 'utf8')).toBe('full\n')
  })
})

describe('a confined command', () => {
  it('writes in the Robot directory, is denied elsewhere with the path, and reads anywhere', async (context) => {
    if (host.sandbox === 'none') return context.skip()
    const outside = join(home, 'denied.txt')
    const inside = await run('echo mine > note.txt && cat note.txt')
    expect(inside).toMatchObject({ exitCode: 0, sandbox: { mode: 'workspace-write', denied: false } })
    expect(inside.stdout.text.trim()).toBe('mine')
    const denied = await run(`echo no > ${outside}`)
    expect(denied.exitCode).not.toBe(0)
    expect(denied.sandbox).toMatchObject({ mode: 'workspace-write', denied: true, deniedPath: outside })
    await expect(stat(outside)).rejects.toThrow()
    expect((await run('cat /etc/hostname', { mode: 'read-only' })).exitCode).toBe(0)
    expect((await run('echo no > again.txt', { mode: 'read-only' })).sandbox).toMatchObject({ mode: 'read-only', denied: true })
  })

  it('writes in the extra roots of the grant', async (context) => {
    if (host.sandbox === 'none') return context.skip()
    const extra = join(home, 'extra')
    await Effect.runPromise(host.rpc['Run']!({ command: `mkdir -p ${extra}`, background: false, job: jobName(), access: access({ mode: 'full' }) }))
    const result = await run(`echo yes > ${extra}/y.txt`, { roots: [extra] })
    expect(result).toMatchObject({ exitCode: 0, sandbox: { denied: false } })
    expect(await readFile(join(extra, 'y.txt'), 'utf8')).toBe('yes\n')
  })
})

describe('the sandbox state', () => {
  it('fails a confined command closed where there is no sandbox, and still runs full', async (context) => {
    if (host.sandbox !== 'none') return context.skip()
    expect((await failure('echo hi')).code).toBe('SANDBOX_UNAVAILABLE')
    expect((await run('echo hi', { mode: 'full' })).exitCode).toBe(0)
  })
})

describe('a login shell whose PATH has no bubblewrap', () => {
  // Deep review P6: the Nix build puts bubblewrap only on the app's PATH, and commands get the login shell's PATH. The sandbox state the
  // heartbeat reports must be what a confined command then gets: it runs with that enforcement, or nothing here confines and it fails closed.
  it('runs confined commands under the sandbox the app found, or reports none', async () => {
    const own = await mkdtemp(join(homedir(), '.mr-robot-host-test-'))
    const bin = join(own, 'bin')
    await mkdir(bin)
    await symlink(execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim(), join(bin, 'bash'))
    const shell = join(own, 'login-shell')
    await writeFile(shell, `#!/bin/sh\nprintf %s '${bin}'\n`)
    await chmod(shell, 0o755)
    const before = process.env['SHELL']
    process.env['SHELL'] = shell
    const short = await connected(own).finally(() => { process.env['SHELL'] = before })
    try {
      const payload = { command: 'echo confined > note.txt && echo "$(<note.txt)"', background: false, job: jobName(), access: access() }
      if (short.sandbox === 'none') {
        expect(((await Effect.runPromise(Effect.flip(short.rpc['Run']!(payload)))) as { code?: string }).code).toBe('SANDBOX_UNAVAILABLE')
        return
      }
      const result = await Effect.runPromise(short.rpc['Run']!(payload))
      expect(result).toMatchObject({ kind: 'foreground', exitCode: 0, sandbox: { mode: 'workspace-write', denied: false, enforcement: short.sandbox } })
      expect(result.stdout.text.trim()).toBe('confined')
    } finally {
      await short.close()
      await rm(own, { recursive: true, force: true })
    }
  })
})

describe('the path of a denied write, read from the error output', () => {
  // The lines are what bash and coreutils print on this machine's bubblewrap, Landlock and Seatbelt; the sandbox itself is not asked.
  it.each([
    ['bash: line 1: /home/u/x.txt: Read-only file system', '/home/u/x.txt'],
    ['bash: line 1: note.txt: Permission denied', 'note.txt'],
    ["touch: cannot touch '/srv/data/a b.txt': Read-only file system", '/srv/data/a b.txt'],
    ["mkdir: cannot create directory '/opt/x': Operation not permitted", '/opt/x'],
  ])('%s', (line, path) => {
    expect(deniedPath(`ok so far\n${line}\n`)).toBe(path)
  })
  it('finds nothing in output without a denial', () => {
    expect(deniedPath('all fine\n')).toBeUndefined()
  })
})
