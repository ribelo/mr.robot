/**
 * What goes into the Box image (v1.16 review, Sa3): the files of infra/computer, which Alchemy builds into the image it deploys. The tool list in
 * docs/box.md comes from an image built from these files (infra/box-tools.ts), and records this hash; the plan test fails when the files change
 * and the list was not made again, so that the docs cannot describe an image other than the one that ships.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BOX_CONTEXT = join(dirname(fileURLToPath(import.meta.url)), 'computer')

/** A short hash of the names and contents of every file in the Box's build context. */
export function boxContextHash(): string {
  const hash = createHash('sha256')
  for (const name of readdirSync(BOX_CONTEXT).sort()) {
    hash.update(`${name}\0`)
    hash.update(readFileSync(join(BOX_CONTEXT, name)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}
