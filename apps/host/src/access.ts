/**
 * Where a Robot may act on this computer (v1.16 ticket 02, ob-wh59, ob-397e): its own directory ~/mr-robot/<robot>/, the roots its
 * grant adds, and the mode. Reads are as wide as the OS user in every mode (ob-xj2y); a write through a file RPC obeys the same mode
 * and roots as a command does, checked here in Node because a file RPC has no shell to confine.
 */
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import * as Data from 'effect/Data'
import { SANDBOX_DENIED, type HostAccess } from '@mr-robot/host-protocol'
import { errorCode } from './error-code.ts'

/** Where the Robot's directory is: mr-robot/<robot> in the OS user's home. */
export const robotDirectory = (home: string, robot: string): string => join(home, 'mr-robot', robot)

/** A path as a Robot gives it: ~ or ~/x is the OS user's home, an absolute path is itself, and a relative one starts in `base`. */
export function expandPath(home: string, base: string, path: string): string {
  if (path === '~') return home
  if (/^~[\\/]/.test(path)) return join(home, path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(base, path)
}

/** The Robot's directory, made on first use, and where it is. */
export async function ensureRobotDirectory(home: string, access: HostAccess): Promise<string> {
  const directory = robotDirectory(home, access.robot)
  await mkdir(directory, { recursive: true })
  return directory
}

/** The directories a command or a file write may change in workspace-write mode: the Robot's own, then the roots of its grant. */
export function writeRoots(home: string, access: HostAccess): string[] {
  const directory = robotDirectory(home, access.robot)
  return [directory, ...access.roots.map((root) => expandPath(home, directory, root))]
}

/** A path with its symbolic links resolved as far as it exists: the deepest existing ancestor's real path, then what does not exist yet. */
async function resolvedPath(path: string): Promise<string> {
  const missing: string[] = []
  let current = path
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse())
    } catch (error) {
      const parent = resolve(current, '..')
      if (errorCode(error) !== 'ENOENT' || parent === current) throw error
      missing.push(current.slice(parent.length + 1))
      current = parent
    }
  }
}

const inside = (root: string, target: string): boolean => {
  const from = relative(root, target)
  return from === '' || (!from.startsWith(`..${sep}`) && from !== '..' && !isAbsolute(from))
}

/** A write the mode and roots refuse; its code is the one the Worker looks for. */
export class WriteDenied extends Data.TaggedError('WriteDenied')<{ readonly message: string }> {
  readonly code = SANDBOX_DENIED
}

const outside = (target: string, access: HostAccess, home: string): WriteDenied =>
  new WriteDenied({ message: `${target} was not written: it is outside the directories this grant lets you change (${writeRoots(home, access).join(', ')}).` })

/** Whether the real path lies inside one of the directories the grant lets the Robot change. */
async function insideWriteRoots(home: string, access: HostAccess, real: string): Promise<boolean> {
  for (const root of writeRoots(home, access)) {
    if (inside(await resolvedPath(root), real)) return true
  }
  return false
}

/**
 * Check that the mode and roots let the Robot change `target` (a path already expanded), and return the real path to act on: the
 * target with its symbolic links resolved. The caller works on that path, not on the one it was given, so that the check and the write
 * see the same file.
 * @throws WriteDenied when the mode or the roots refuse the write.
 */
export async function assertMayWrite(home: string, access: HostAccess, target: string): Promise<string> {
  if (access.mode === 'full') return target
  if (access.mode === 'read-only') throw new WriteDenied({ message: `${target} was not written: this grant is read-only, so nothing on this computer may be changed.` })
  const real = await resolvedPath(target)
  if (await insideWriteRoots(home, access, real)) return real
  throw outside(target, access, home)
}

/** As assertMayWrite, for deleting: a symbolic link itself may go when it lies inside the roots, whatever it points at. The path returned is the link's own, in its resolved directory. */
export async function assertMayRemove(home: string, access: HostAccess, target: string): Promise<string> {
  if (access.mode === 'full') return target
  if (access.mode === 'read-only') throw new WriteDenied({ message: `${target} was not changed: this grant is read-only, so nothing on this computer may be changed.` })
  const real = join(await resolvedPath(dirname(target)), basename(target))
  if (await insideWriteRoots(home, access, real)) return real
  throw outside(target, access, home)
}

/** Delete one file or link that the grant lets the Robot change; false when it is not there. */
export async function removeWithin(home: string, access: HostAccess, target: string): Promise<boolean> {
  const real = await assertMayRemove(home, access, target)
  try {
    await unlink(real)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/**
 * Write a whole file where the grant allows. In a confined mode the final path component is never followed (O_NOFOLLOW, so a link left
 * in the Robot's directory cannot lead the write out of it), and the file that was opened is checked once more: it must be the very file
 * at a real path inside the roots. Nothing is truncated before that check passes.
 * @throws WriteDenied when the mode or the roots refuse the write.
 */
export async function writeWithin(home: string, access: HostAccess, target: string, body: Uint8Array): Promise<void> {
  const real = await assertMayWrite(home, access, target)
  await mkdir(dirname(real), { recursive: true })
  if (access.mode === 'full') {
    const handle = await open(real, 'w')
    try { await handle.write(body, 0, body.length, 0) } finally { await handle.close() }
    return
  }
  const noFollow = constants.O_NOFOLLOW ?? 0
  let created = true
  let handle
  try {
    handle = await open(real, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow)
  } catch (error) {
    if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'ELOOP') throw error
    created = false
    try {
      handle = await open(real, constants.O_WRONLY | noFollow)
    } catch (second) {
      if (errorCode(second) === 'ELOOP') throw outside(target, access, home)
      throw second
    }
  }
  try {
    const opened = await handle.stat({ bigint: true })
    const named = await lstat(real, { bigint: true }).catch(() => undefined)
    const sameFile = named !== undefined && named.isFile() && named.dev === opened.dev && named.ino === opened.ino
    if (!sameFile || !(await insideWriteRoots(home, access, await realpath(real)))) {
      if (created && sameFile) await unlink(real).catch(() => undefined)
      throw outside(target, access, home)
    }
    await handle.truncate(0)
    await handle.write(body, 0, body.length, 0)
  } finally {
    await handle.close()
  }
}
