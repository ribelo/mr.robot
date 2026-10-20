/**
 * A Robot's files on this computer (v1.16 ticket 02): its directory, the mode and roots of its grant on writes, reads as wide as the OS
 * user, and list, search and delete. Driven through the Host protocol over real files, as the Worker drives them. Every change runs in the
 * machine's real sandbox (bubblewrap or Landlock), so the test directory is in the home directory and not in /tmp, which a confined
 * process may write (bubblewrap gives it a private one).
 */
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CopyIo } from '@mr-robot/host-protocol'
import { access, connected } from './connected.ts'

/** R2 behind every presigned URL: one object, answered by range. */
const OBJECT = new TextEncoder().encode('downloaded bytes')
const r2: CopyIo = {
  sleep: async () => undefined,
  fetch: async (_url, init) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
    return range === null ? new Response('no', { status: 400 }) : new Response(OBJECT.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
  },
}
const download = (path: string) => ({ path, url: 'https://r2.test/x', size: OBJECT.length, partBytes: OBJECT.length, from: 0, until: OBJECT.length, access: access() })

let home = ''
let host: Awaited<ReturnType<typeof connected>>
const robotDir = () => join(home, 'mr-robot', 'bot')
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const failure = (name: string, payload: unknown) => Effect.runPromise(Effect.flip(host.rpc[name]!(payload))) as Promise<{ message: string; code?: string }>

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-files-'))
  host = await connected(home, r2)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('the Robot directory', () => {
  it('is made on first use and is where a relative path starts', async () => {
    await expect(stat(robotDir())).rejects.toThrow()
    const written = await call('Write', { path: 'notes/today.md', text: 'hello', access: access() })
    expect(written.path).toBe(join(robotDir(), 'notes', 'today.md'))
    expect(await readFile(written.path, 'utf8')).toBe('hello')
    expect((await call('Read', { path: 'notes/today.md', access: access() })).text).toBe('hello')
  })
})

describe('writes obey the mode and the roots of the grant', () => {
  it('refuses a write outside the Robot directory in workspace-write, naming the path, and leaves nothing behind', async () => {
    const outside = join(home, 'elsewhere', 'x.txt')
    const denied = await failure('Write', { path: outside, text: 'no', access: access() })
    expect(denied.code).toBe('SANDBOX_DENIED')
    expect(denied.message).toContain(outside)
    await expect(stat(join(home, 'elsewhere'))).rejects.toThrow()
  })

  it('allows a write in a root the grant names, with ~ for the home directory', async () => {
    const written = await call('Write', { path: join(home, 'shared', 'a.txt'), text: 'ok', access: access({ roots: ['~/shared'] }) })
    expect(await readFile(written.path, 'utf8')).toBe('ok')
  })

  it('refuses every write in read-only, also in the Robot directory, and allows every write in full', async () => {
    expect((await failure('Write', { path: 'ro.txt', text: 'no', access: access({ mode: 'read-only' }) })).code).toBe('SANDBOX_DENIED')
    expect((await failure('Download', { path: 'ro.bin', url: 'https://r2.test/x', size: 1, partBytes: 1, from: 0, until: 1, access: access({ mode: 'read-only' }) })).code).toBe('SANDBOX_DENIED')
    const anywhere = join(home, 'anywhere.txt')
    await call('Write', { path: anywhere, text: 'full', access: access({ mode: 'full' }) })
    expect(await readFile(anywhere, 'utf8')).toBe('full')
  })

  it('does not follow a link out of the Robot directory', async () => {
    const target = join(home, 'link-target')
    await mkdir(target, { recursive: true })
    await mkdir(robotDir(), { recursive: true })
    await symlink(target, join(robotDir(), 'door'))
    expect((await failure('Write', { path: 'door/x.txt', text: 'no', access: access() })).code).toBe('SANDBOX_DENIED')
    await expect(stat(join(target, 'x.txt'))).rejects.toThrow()
  })

  it('does not write through a link left in the Robot directory that points out of it, even when its target is not there yet', async () => {
    const outside = join(home, 'not-yet-there.txt')
    await mkdir(robotDir(), { recursive: true })
    await symlink(outside, join(robotDir(), 'dangling'))
    expect((await failure('Write', { path: 'dangling', text: 'no', access: access() })).code).toBe('SANDBOX_DENIED')
    await expect(stat(outside)).rejects.toThrow()
    // A link to a file inside the Robot directory is a way to that file, and the write lands there.
    await writeFile(join(robotDir(), 'real.txt'), 'old')
    await symlink(join(robotDir(), 'real.txt'), join(robotDir(), 'inside'))
    await call('Write', { path: 'inside', text: 'new', access: access() })
    expect(await readFile(join(robotDir(), 'real.txt'), 'utf8')).toBe('new')
  })

  it('reads anything the OS user can read, in every mode', async () => {
    const secret = join(home, 'outside-note.txt')
    await writeFile(secret, 'readable')
    for (const mode of ['read-only', 'workspace-write', 'full'] as const) {
      expect((await call('Read', { path: secret, access: access({ mode }) })).text).toBe('readable')
    }
  })
})

// Deep review P1: the app's check of a path and the change itself are two moments, and links on the path can change between them; the
// change runs in the sandbox, which refuses whatever the links lead to by then. Each case leaves the link in place before the call.
describe('a change cannot leave the roots through a link on its path', () => {
  const outsideFile = async (name: string) => {
    const path = join(home, name)
    await writeFile(path, 'keep')
    return path
  }

  it('does not download through a link planted at the part file', async () => {
    const victim = await outsideFile('planted-part-victim')
    await mkdir(robotDir(), { recursive: true })
    await symlink(victim, join(robotDir(), 'planted.bin.mr-robot-part'))
    expect((await failure('Download', download('planted.bin'))).code).toBe('SANDBOX_DENIED')
    expect(await readFile(victim, 'utf8')).toBe('keep')
    await expect(stat(join(robotDir(), 'planted.bin'))).rejects.toThrow()
    // A download with no link in its way lands, and leaves no part file.
    await call('Download', download('fetched/plain.bin'))
    expect(await readFile(join(robotDir(), 'fetched', 'plain.bin'), 'utf8')).toBe('downloaded bytes')
    expect(await readdir(join(robotDir(), 'fetched'))).toEqual(['plain.bin'])
  })

  it('does not write or download through a final component that links out to a file', async () => {
    const victim = await outsideFile('final-link-victim')
    await mkdir(robotDir(), { recursive: true })
    await symlink(victim, join(robotDir(), 'final-link'))
    expect((await failure('Write', { path: 'final-link', text: 'no', access: access() })).code).toBe('SANDBOX_DENIED')
    expect((await failure('Download', download('final-link'))).code).toBe('SANDBOX_DENIED')
    expect(await readFile(victim, 'utf8')).toBe('keep')
    expect((await lstat(join(robotDir(), 'final-link'))).isSymbolicLink()).toBe(true)
  })

  it('does not write or download through a directory on the path that links out', async () => {
    const outside = join(home, 'swapped-outside')
    await mkdir(outside, { recursive: true })
    await mkdir(robotDir(), { recursive: true })
    await symlink(outside, join(robotDir(), 'swapped'))
    expect((await failure('Write', { path: 'swapped/deeper/x.txt', text: 'no', access: access() })).code).toBe('SANDBOX_DENIED')
    expect((await failure('Download', download('swapped/y.bin'))).code).toBe('SANDBOX_DENIED')
    expect(await readdir(outside)).toEqual([])
  })

  it('does not delete through a directory on the path that links out', async () => {
    const outside = join(home, 'delete-outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'keep.txt'), 'keep')
    await mkdir(robotDir(), { recursive: true })
    await symlink(outside, join(robotDir(), 'delete-door'))
    expect((await failure('Delete', { path: 'delete-door/keep.txt', access: access() })).code).toBe('SANDBOX_DENIED')
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    // The link itself lies in the Robot directory and may go; what it points at stays.
    await call('Delete', { path: 'delete-door', access: access() })
    await expect(lstat(join(robotDir(), 'delete-door'))).rejects.toThrow()
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })
})

describe('list, search and delete', () => {
  it('lists files by a glob with the paths as the pattern sees them, skipping .git and node_modules', async () => {
    for (const path of ['src/a.ts', 'src/deep/b.ts', 'src/c.md', 'node_modules/x/d.ts', '.git/e.ts']) await call('Write', { path: join('glob', path), text: 'x', access: access() })
    const found = await call('Glob', { pattern: 'glob/**/*.ts', access: access() })
    expect(found.paths).toEqual(['glob/src/a.ts', 'glob/src/deep/b.ts'])
    expect((await call('Glob', { pattern: 'glob/src/*.md', access: access() })).paths).toEqual(['glob/src/c.md'])
  })

  it('searches text files with a regular expression under a directory, with an optional file glob', async () => {
    await call('Write', { path: 'find/one.txt', text: 'alpha\nNeedle here\nomega', access: access() })
    await call('Write', { path: 'find/two.md', text: 'needle again', access: access() })
    await call('Write', { path: 'find/blob.bin', base64: Buffer.from([110, 101, 101, 100, 108, 101, 0, 1]).toString('base64'), access: access() })
    const all = await call('Grep', { pattern: 'needle', ignoreCase: true, path: 'find', access: access() })
    expect(all.matches).toEqual([{ path: 'find/two.md', line: 1, text: 'needle again' }, { path: 'find/one.txt', line: 2, text: 'Needle here' }].sort((a, b) => (a.path < b.path ? -1 : 1)))
    expect((await call('Grep', { pattern: 'needle', ignoreCase: false, path: 'find', access: access() })).matches).toEqual([{ path: 'find/two.md', line: 1, text: 'needle again' }])
    expect((await call('Grep', { pattern: 'needle', ignoreCase: true, glob: 'find/*.txt', path: 'find', access: access() })).matches.map((match) => match.path)).toEqual(['find/one.txt'])
  })

  it('deletes a file in the Robot directory, and refuses outside it, a missing file and a directory', async () => {
    await call('Write', { path: 'gone.txt', text: 'x', access: access() })
    expect((await call('Delete', { path: 'gone.txt', access: access() })).path).toBe(join(robotDir(), 'gone.txt'))
    await expect(stat(join(robotDir(), 'gone.txt'))).rejects.toThrow()
    expect((await failure('Delete', { path: 'gone.txt', access: access() })).code).toBe('ENOENT')
    expect((await failure('Delete', { path: 'find', access: access() })).code).toBe('EISDIR')
    const outside = join(home, 'keep.txt')
    await writeFile(outside, 'keep')
    expect((await failure('Delete', { path: outside, access: access() })).code).toBe('SANDBOX_DENIED')
    expect(await readFile(outside, 'utf8')).toBe('keep')
  })
})
