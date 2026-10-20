/**
 * Where a Robot may act on this computer (v1.16 ticket 02, ob-wh59, ob-397e): its own directory ~/mr-robot/<robot>/, the roots its
 * grant adds, and the mode. Reads are as wide as the OS user in every mode (ob-xj2y); a write through a file RPC obeys the same mode
 * and roots as a command does, checked here in Node because a file RPC has no shell to confine.
 */
import { mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { SANDBOX_DENIED, type HostAccess } from '@mr-robot/host-protocol'

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
async function realish(path: string): Promise<string> {
  const missing: string[] = []
  let current = path
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse())
    } catch (error) {
      const parent = resolve(current, '..')
      if ((error as { code?: unknown }).code !== 'ENOENT' || parent === current) throw error
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
export class WriteDenied extends Error {
  readonly code = SANDBOX_DENIED
}

/** Fail with WriteDenied unless the mode lets the Robot change `target` (a path already expanded). */
export async function assertMayWrite(home: string, access: HostAccess, target: string): Promise<void> {
  if (access.mode === 'full') return
  if (access.mode === 'read-only') throw new WriteDenied(`${target} was not written: this grant is read-only, so nothing on this computer may be changed.`)
  const real = await realish(target)
  for (const root of writeRoots(home, access)) {
    if (inside(await realish(root), real)) return
  }
  throw new WriteDenied(`${target} was not written: it is outside the directories this grant lets you change (${writeRoots(home, access).join(', ')}).`)
}
