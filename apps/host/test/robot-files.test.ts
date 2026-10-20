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
import { access, connected, jobName } from './connected.ts'

/** R2 behind every presigned URL: one object, answered by range. */
const OBJECT = new TextEncoder().encode('downloaded bytes')
const r2: CopyIo = {
  sleep: async () => undefined,
  fetch: async (_url, init) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
    return range === null ? new Response('no', { status: 400 }) : new Response(OBJECT.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
  },
}
const download = (path: string, window: { readonly copy?: string; readonly from?: number; readonly until?: number } = {}) =>
  ({ copy: window.copy ?? crypto.randomUUID(), path, url: 'https://r2.test/x', size: OBJECT.length, partBytes: 8, from: window.from ?? 0, until: window.until ?? OBJECT.length, access: access() })

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
    expect((await failure('Download', { copy: crypto.randomUUID(), path: 'ro.bin', url: 'https://r2.test/x', size: 1, partBytes: 1, from: 0, until: 1, access: access({ mode: 'read-only' }) })).code).toBe('SANDBOX_DENIED')
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
    // The first window of a copy makes its part file; the Robot swaps it for a link before the next window comes (deep review P1, P12).
    const copy = crypto.randomUUID()
    await call('Download', download('planted.bin', { copy, until: 8 }))
    const part = (await readdir(robotDir())).find((name) => /^planted\.bin\.[0-9a-f]+\.mr-robot-part$/.test(name))
    expect(part).toBeDefined()
    await rm(join(robotDir(), part!))
    await symlink(victim, join(robotDir(), part!))
    expect((await failure('Download', download('planted.bin', { copy, from: 8 }))).code).toBe('SANDBOX_DENIED')
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

// Deep review P1b: the sandbox opens each write root when it starts and follows a link there, so a root inside another root could be
// swapped for a link by the Robot itself. Such roots, and a root reached through a link, are refused for commands and file changes alike.
describe('write roots the sandbox cannot hold', () => {
  const runFailure = (command: string, grant: ReturnType<typeof access>) => failure('Run', { command, background: false, job: jobName(), access: grant })

  it('are refused when the Robot replaced an inner root by a link, and nothing lands where the link points', async () => {
    const victim = join(home, 'roots-victim')
    await mkdir(victim, { recursive: true })
    await mkdir(join(home, 'project'), { recursive: true })
    await mkdir(join(home, 'mr-robot'), { recursive: true })
    // What a Robot granted ~/project (or ~/mr-robot) can do: put a link where the inner root (or its own directory) was. The link stays
    // when the owner drops the outer root.
    const inner = join(home, 'project', 'inner')
    await symlink(victim, inner)
    const cases = [
      { grant: access({ roots: ['~/project', '~/project/inner'] }), link: inner },
      { grant: access({ roots: ['~/project/inner'] }), link: inner },
    ]
    for (const { grant, link } of cases) {
      const write = await failure('Write', { path: join(link, 'x.txt'), text: 'no', access: grant })
      expect(write.code).toBe('SANDBOX_DENIED')
      expect(write.message).toContain(`${link} is a symbolic link`)
      expect((await runFailure(`echo no > ${link}/y.txt`, grant)).code).toBe('SANDBOX_DENIED')
    }
    expect(await readdir(victim)).toEqual([])
  })

  it('are refused when one lies inside another or holds the Robot directory, compared by real path; roots side by side run', async () => {
    await mkdir(join(home, 'outer', 'inner'), { recursive: true })
    for (const roots of [['~/outer', join(home, 'outer', 'inner')], ['~'], [join(home, 'mr-robot')]]) {
      const write = await failure('Write', { path: 'nested.txt', text: 'no', access: access({ roots }) })
      expect(write.code).toBe('SANDBOX_DENIED')
      expect(write.message).toContain('lies inside')
      expect((await runFailure('true', access({ roots }))).code).toBe('SANDBOX_DENIED')
    }
    await expect(stat(join(robotDir(), 'nested.txt'))).rejects.toThrow()
    const written = await call('Write', { path: join(home, 'outer', 'inner', 'ok.txt'), text: 'ok', access: access({ roots: [join(home, 'outer', 'inner'), '~/side'] }) })
    expect(await readFile(written.path, 'utf8')).toBe('ok')
  })
})

// Deep review P17: the app makes a Robot's directory itself, outside the sandbox, so a link on the way to it (~/mr-robot, or the
// directory) would have it made where the link points. Such a link is refused for every call, in every mode, before anything is made.
describe('a Robot directory reached through a link', () => {
  it('is refused for reads, changes and commands in every mode, and nothing appears where the link points', async () => {
    const victim = join(home, 'linked-victim')
    await mkdir(victim, { recursive: true })
    const linkedDirectory = join(home, 'mr-robot', 'linked')
    await mkdir(join(home, 'mr-robot'), { recursive: true })
    await symlink(victim, linkedDirectory)
    const linkedHome = await mkdtemp(join(homedir(), '.mr-robot-host-linked-'))
    const robots = join(linkedHome, 'mr-robot')
    await symlink(victim, robots)
    const elsewhere = await connected(linkedHome, r2)
    try {
      const cases = [
        { on: host, robot: 'linked', link: linkedDirectory },
        { on: elsewhere, robot: 'bot', link: robots },
      ]
      for (const { on, robot, link } of cases) {
        for (const mode of ['read-only', 'workspace-write', 'full'] as const) {
          const grant = access({ robot, mode })
          for (const [name, payload] of [
            ['Read', { path: join(home, 'outside-note.txt') }],
            ['Glob', { pattern: '*' }],
            ['Write', { path: 'x.txt', text: 'no' }],
            ['Run', { command: 'echo no > y.txt', background: false, job: jobName(robot) }],
          ] as const) {
            const refused = await Effect.runPromise(Effect.flip(on.rpc[name]!({ ...payload, access: grant }))) as { message: string }
            expect(refused.message).toContain(`${link} is a symbolic link`)
          }
        }
      }
      expect(await readdir(victim)).toEqual([])
    } finally {
      await elsewhere.close()
      await rm(linkedHome, { recursive: true, force: true })
    }
  })
})

// Deep review P1c: Landlock lets every confined command change the real /tmp, so a root there, or the Robot's directory in a home there,
// could be swapped for a link between two calls. Such roots are refused, for commands and file changes alike.
describe('write roots inside a directory the sandbox leaves writable', () => {
  it('are refused under Landlock, and nothing is written in them', async () => {
    const temp = await mkdtemp('/tmp/mr-robot-temp-root-')
    const tempHome = await mkdtemp('/tmp/mr-robot-temp-home-')
    const landlock = await connected(home, r2, { sandboxChain: ['landlock'] })
    const landlockInTemp = await connected(tempHome, r2, { sandboxChain: ['landlock'] })
    try {
      const fails = (on: typeof landlock, name: string, payload: unknown) => Effect.runPromise(Effect.flip(on.rpc[name]!(payload))) as Promise<{ message: string; code?: string }>
      const cases = [
        { on: landlock, grant: access({ roots: [temp] }), path: join(temp, 'x.txt'), inside: `the write root ${temp} lies inside /tmp` },
        { on: landlockInTemp, grant: access(), path: 'x.txt', inside: `your directory ${join(tempHome, 'mr-robot', 'bot')} lies inside /tmp` },
      ]
      for (const { on, grant, path, inside } of cases) {
        const write = await fails(on, 'Write', { path, text: 'no', access: grant })
        const run = await fails(on, 'Run', { command: 'echo no > y.txt', background: false, job: jobName(), access: grant })
        // Without Landlock on this machine the calls fail closed for that reason instead.
        if (landlock.sandbox === 'none') continue
        expect(write.code).toBe('SANDBOX_DENIED')
        expect(write.message).toContain(inside)
        expect(run.code).toBe('SANDBOX_DENIED')
      }
      expect(await readdir(temp)).toEqual([])
      for (const name of ['x.txt', 'y.txt']) await expect(stat(join(tempHome, 'mr-robot', 'bot', name))).rejects.toThrow()
      // A root out of the temporary directories still takes changes under Landlock.
      if (landlock.sandbox !== 'none') await Effect.runPromise(landlock.rpc['Write']!({ path: join(home, 'beside-temp', 'ok.txt'), text: 'ok', access: access({ roots: ['~/beside-temp'] }) }))
    } finally {
      await landlock.close()
      await landlockInTemp.close()
      await rm(temp, { recursive: true, force: true })
      await rm(tempHome, { recursive: true, force: true })
    }
  })
})

describe('list, search and delete', () => {
  it('lists files by a glob with the paths as the pattern sees them, skipping .git, node_modules and .cache', async () => {
    for (const path of ['src/a.ts', 'src/deep/b.ts', 'src/c.md', 'node_modules/x/d.ts', '.git/e.ts', 'src/.cache/f.ts']) await call('Write', { path: join('glob', path), text: 'x', access: access() })
    const found = await call('Glob', { pattern: 'glob/**/*.ts', access: access() })
    expect(found).toEqual({ paths: ['glob/src/a.ts', 'glob/src/deep/b.ts'], truncated: false })
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
    expect(all.truncated).toBe(false)
  })

  it('says a search is truncated when it has more matches than it returns (deep review P15)', async () => {
    await call('Write', { path: 'many/exact.txt', text: 'hit\n'.repeat(200), access: access() })
    await call('Write', { path: 'many/more/over.txt', text: 'hit\n'.repeat(201), access: access() })
    const exact = await call('Grep', { pattern: 'hit', ignoreCase: false, path: 'many/exact.txt', access: access() })
    expect(exact.matches).toHaveLength(200)
    expect(exact.truncated).toBe(false)
    const over = await call('Grep', { pattern: 'hit', ignoreCase: false, path: 'many/more', access: access() })
    expect(over.matches).toHaveLength(200)
    expect(over.truncated).toBe(true)
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
