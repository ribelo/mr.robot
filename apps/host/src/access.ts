/**
 * Where a Robot may act on this computer (v1.16 ticket 02, ob-wh59, ob-397e): its own directory ~/mr-robot/<robot>/, the roots its
 * grant adds, and the mode. Reads are as wide as the OS user in every mode (ob-xj2y). A change of a file obeys the same mode and roots as
 * a command does: it runs in the sandbox too (file-change.ts); the checks here only refuse a plain miss early, in words the Robot reads.
 */
import { mkdir, realpath, stat } from 'node:fs/promises'
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

/** The directories a command or a file change may change in workspace-write mode: the Robot's own, then the roots of its grant. */
export function writeRoots(home: string, access: HostAccess): string[] {
  const directory = robotDirectory(home, access.robot)
  return [directory, ...access.roots.map((root) => expandPath(home, directory, root))]
}

/**
 * The extra roots of a workspace-write grant that the sandbox can confine to, each made on first use like the Robot's directory (the
 * sandbox binds only a directory that is there). A root that cannot be made is left out: nothing in it can be changed then.
 */
export async function madeExtraRoots(home: string, access: HostAccess): Promise<string[]> {
  if (access.mode !== 'workspace-write') return []
  const made: string[] = []
  for (const root of writeRoots(home, access).slice(1)) {
    await mkdir(root, { recursive: true }).catch(() => undefined)
    if (await stat(root).then(() => true, () => false)) made.push(root)
  }
  return made
}

/** A path with its symbolic links resolved as far as it exists: the deepest existing ancestor's real path, then what does not exist yet. */
export async function resolvedPath(path: string): Promise<string> {
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

/**
 * Refuse early a change of `target` (a path already expanded) that the mode or the roots plainly refuse: every change in read-only, and in
 * workspace-write a path that lies in no write root, neither as written nor with its links resolved (`resolved`). This is not the
 * boundary: a path that passes may still lead out of the roots through a link, and the sandbox the change runs in refuses that.
 */
async function refusePlainMiss(home: string, access: HostAccess, target: string, resolved: () => Promise<string>, verb: string): Promise<void> {
  if (access.mode === 'full') return
  if (access.mode === 'read-only') throw new WriteDenied({ message: `${target} was not ${verb}: this grant is read-only, so nothing on this computer may be changed.` })
  const roots = writeRoots(home, access)
  if (roots.some((root) => inside(root, target))) return
  const real = await resolved()
  for (const root of roots) {
    if (inside(await resolvedPath(root), real)) return
  }
  throw new WriteDenied({ message: `${target} was not ${verb}: it is outside the directories this grant lets you change (${roots.join(', ')}).` })
}

/**
 * Check a write of `target` before it runs in the sandbox (see refusePlainMiss).
 * @throws WriteDenied when the mode or the roots plainly refuse it.
 */
export const assertMayWrite = (home: string, access: HostAccess, target: string): Promise<void> =>
  refusePlainMiss(home, access, target, () => resolvedPath(target), 'written')

/**
 * As assertMayWrite, for deleting: a link itself may go when it lies inside the roots, whatever it points at.
 * @throws WriteDenied when the mode or the roots plainly refuse it.
 */
export const assertMayRemove = (home: string, access: HostAccess, target: string): Promise<void> =>
  refusePlainMiss(home, access, target, async () => join(await resolvedPath(dirname(target)), basename(target)), 'changed')
