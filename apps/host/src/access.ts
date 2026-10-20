/**
 * Where a Robot may act on this computer (v1.16 ticket 02, ob-wh59, ob-397e): its own directory ~/mr-robot/<robot>/, the roots its
 * grant adds, and the mode. Reads are as wide as the OS user in every mode (ob-xj2y). A change of a file obeys the same mode and roots as
 * a command does: it runs in the sandbox too (file-change.ts); the checks here only refuse a plain miss early, in words the Robot reads.
 */
import { lstat, mkdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
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

/** On a file system that ignores case (macOS and Windows by default) two spellings name one directory, so real paths compare without it. */
const comparable = (path: string): string => (process.platform === 'darwin' || process.platform === 'win32' ? path.toLowerCase() : path)

/**
 * The first symbolic link (a Windows junction too) on the way to `path`, the path itself included; undefined when there is none. The walk
 * starts at the OS user's home directory when the path lies in it, since what leads to the home is the OS's and not writable by the user,
 * and it ends at the first component that is not there yet.
 */
async function linkOnTheWay(home: string, path: string): Promise<string | undefined> {
  const start = inside(home, path) ? home : parse(path).root
  let current = start
  for (const part of relative(start, path).split(sep)) {
    if (part === '') continue
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return undefined
      throw error
    }
    if (info.isSymbolicLink()) return current
  }
  return undefined
}

/**
 * Check, before a command or a file change starts in workspace-write mode, that the sandbox can hold the grant's write roots (deep review
 * P1b, P1c). bubblewrap and Landlock open each root when they start and follow a link there; so a root that lies inside another root (the
 * Robot's directory among them), or inside a directory every confined command may change (`sandboxWritable`: the temp directories the
 * sandbox grants, such as the real /tmp under Landlock), could be swapped for a link to any directory by the Robot itself, and one already
 * behind a link leads where the link points. All are refused: no root may be or pass through a symbolic link now, and none may lie inside
 * another or inside a directory of `sandboxWritable`, compared by real path. Other modes bind no root.
 * @throws WriteDenied naming the link or the two directories, so that the owner can change the roots.
 */
export async function assertConfinableRoots(home: string, access: HostAccess, sandboxWritable: readonly string[]): Promise<void> {
  if (access.mode !== 'workspace-write') return
  const roots = writeRoots(home, access)
  const directory = roots[0]
  const named = (root: string): string => (root === directory ? `your directory ${root}` : `the write root ${root}`)
  const refused = (why: string): WriteDenied =>
    new WriteDenied({ message: `No command runs and no file is changed under this grant on this computer: ${why} Ask your owner to change the write roots of the grant in your settings so that none lies inside another, inside your directory or inside a temporary directory, and none is reached through a link.` })
  for (const root of roots) {
    const link = await linkOnTheWay(home, root)
    if (link !== undefined) throw refused(`${link} is a symbolic link on the way to ${named(root)}, and the sandbox would let you change what it points at.`)
  }
  // A root that cannot be resolved (a file on the way) cannot be made either, and the sandbox gets no such root (madeExtraRoots).
  const real = await Promise.all(roots.map((root) => resolvedPath(root).then(comparable, () => undefined)))
  const writable = sandboxWritable.map(comparable)
  for (const [i, root] of real.entries()) {
    const temp = writable.find((path) => root !== undefined && root !== path && inside(path, root))
    if (temp !== undefined) throw refused(`${named(roots[i]!)} lies inside ${temp}, which every command in the sandbox may change, so a link put in its place would let you change any directory.`)
  }
  for (const [i, inner] of real.entries()) {
    for (const [j, outer] of real.entries()) {
      if (inner === undefined || outer === undefined || inner === outer || !inside(outer, inner)) continue
      throw refused(`${named(roots[i]!)} lies inside ${named(roots[j]!)}, so a link put in its place would let you change any directory.`)
    }
  }
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
