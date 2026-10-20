/**
 * What a Robot may do on a Host (v1.16 ticket 02, ob-wh59, ob-397e): the mode and write roots of each Host facet grant, and the name of
 * the Robot's own directory on every Host. Pure; the Robot DO keeps the values and the Host app enforces them.
 */
import { DEFAULT_HOST_GRANT_ACCESS, isHostRoot, type HostAccessByFacet, type HostGrantAccess } from '@mr-robot/protocol'

/** The Robot's keys for them: the access map by facet, and the directory name chosen at first use. */
export const HOST_ACCESS = 'host-access'
export const HOST_DIRECTORY = 'host-directory'

/** The most roots one grant lists: a short list a person reads. */
export const MAX_HOST_ROOTS = 20

/** A request's access map as the Robot keeps it: roots trimmed and without duplicates, defaults left out. A bad root is the error. */
export function parseHostAccess(input: HostAccessByFacet): { readonly access: HostAccessByFacet } | { readonly invalid: string } {
  const access: Record<string, HostGrantAccess> = {}
  for (const [facet, given] of Object.entries(input)) {
    if (!/^[^:]+:(files|shell)$/.test(facet)) return { invalid: `"${facet}" is not a files or shell grant of a Host` }
    const roots = [...new Set(given.roots.map((root) => root.trim()).filter((root) => root !== ''))]
    const bad = roots.find((root) => !isHostRoot(root))
    if (bad !== undefined) return { invalid: `"${bad}" is not a directory on a computer: write an absolute path or one that starts with ~/` }
    if (roots.length > MAX_HOST_ROOTS) return { invalid: `a grant lists at most ${MAX_HOST_ROOTS} write roots` }
    if (given.mode !== DEFAULT_HOST_GRANT_ACCESS.mode || roots.length > 0) access[facet] = { mode: given.mode, roots }
  }
  return { access }
}

/** The access of one Host facet: what its grant names, else the default. */
export const hostAccessOf = (stored: HostAccessByFacet | undefined, facet: string): HostGrantAccess => stored?.[facet] ?? DEFAULT_HOST_GRANT_ACCESS

/**
 * The name of a Robot's directory under mr-robot/ on a Host: its name as it was at first use, made safe for a file name, and the start of
 * its id so that two Robots with one name do not share a directory. The Robot keeps it, so a rename does not lose its files.
 */
export function robotDirectoryName(name: string, id: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '')
  return `${slug === '' ? 'robot' : slug}-${id.replace(/^r-/, '').slice(0, 8)}`
}
