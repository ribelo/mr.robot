/**
 * A Robot's files on this computer (v1.16 ticket 02): its directory, the mode and roots of its grant on writes, reads as wide as the OS
 * user, and list, search and delete done in Node. Driven through the Host protocol over real files, as the Worker drives them.
 */
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { access, connected } from './connected.ts'

let home = ''
let host: Awaited<ReturnType<typeof connected>>
const robotDir = () => join(home, 'mr-robot', 'bot')
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))
const failure = (name: string, payload: unknown) => Effect.runPromise(Effect.flip(host.rpc[name]!(payload))) as Promise<{ message: string; code?: string }>

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'host-files-'))
  host = await connected(home)
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
    expect((await failure('WriteChunk', { path: 'ro.bin', offset: 0, base64: 'AAAA', access: access({ mode: 'read-only' }) })).code).toBe('SANDBOX_DENIED')
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

  it('reads anything the OS user can read, in every mode', async () => {
    const secret = join(home, 'outside-note.txt')
    await writeFile(secret, 'readable')
    for (const mode of ['read-only', 'workspace-write', 'full'] as const) {
      expect((await call('Read', { path: secret, access: access({ mode }) })).text).toBe('readable')
    }
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
