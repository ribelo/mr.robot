/**
 * The uv and Bun caches of a Box (ob-phi5, deep review P7). The image points UV_CACHE_DIR and BUN_INSTALL_CACHE_DIR into
 * /workspace/box/.cache. The per-file sync of box/ cannot keep them: it leaves out files over 20 MB, and uv keeps packages unpacked in its
 * cache, so a cache with one file missing is a broken package that uv takes for a hit. Thousands of small files would also slow every boot
 * and swell the sync's manifest.
 *
 * So the caches are kept whole, as one archive in the Workspace (box/.cache.tar.zst), and never file by file: before the Box stops they are
 * packed and put with ws; when it boots, before setup.sh, the archive is fetched with ws and unpacked. When nothing in the caches changed
 * since the boot, the archive is not sent again. A missing or broken archive means a cold cache, never a failed boot or stop.
 */
import { BOX_ROOT } from '../places/files.ts'
import { runWs, type CopyPermits, type WsRun } from '../places/copy-permit.ts'
import type { BoxBackend } from './backend.ts'

/** The caches' folder under the Box's /workspace/box, which the box/ sync leaves out. */
export const BOX_CACHE_FOLDER = '.cache'
/** The Workspace key of the caches' archive. */
export const BOX_CACHE_KEY = 'box/.cache.tar.zst'

/** Whether a Workspace key is the caches' archive or lies in box/.cache/: neither is copied to the Box file by file. */
export function inBoxCache(key: string): boolean {
  return key === BOX_CACHE_KEY || key.startsWith(`box/${BOX_CACHE_FOLDER}/`)
}

/** What a boot did with the caches. */
export type BoxCacheRestore =
  | { readonly _tag: 'NoArchive' }
  | { readonly _tag: 'Restored'; readonly bytes: number }
  | { readonly _tag: 'Cold'; readonly reason: string }

/** What a stop did with the caches. */
export type BoxCacheSave =
  | { readonly _tag: 'NoCache' }
  | { readonly _tag: 'Unchanged' }
  | { readonly _tag: 'Saved'; readonly bytes: number }
  | { readonly _tag: 'NotSaved'; readonly reason: string }

/** The archive on the Box's scratch disk, and the stamp of the caches as the boot unpacked them. */
const ARCHIVE = '/tmp/mr-robot/box-cache.tar.zst'
const STAMP = '/tmp/mr-robot/box-cache.stamp'
/** Packing or unpacking a few GB of caches. */
const ARCHIVE_SECONDS = 900
/** Paths below run in the Box's /workspace. */
const CACHE = `box/${BOX_CACHE_FOLDER}`
/** Every entry of the caches with its size and change time, hashed: a different stamp means the caches changed. */
const STAMP_OF_CACHE = `find ${CACHE} -printf '%P %s %T@\\n' | LC_ALL=C sort | md5sum`

/** Prints none, unchanged, or "packed <bytes>" once the archive is written. */
const PACK = [
  'set -e -o pipefail',
  `if [ ! -d ${CACHE} ]; then echo none; exit 0; fi`,
  `stamp="$(${STAMP_OF_CACHE})"`,
  `if [ "$stamp" = "$(cat ${STAMP} 2>/dev/null)" ]; then echo unchanged; exit 0; fi`,
  'mkdir -p /tmp/mr-robot',
  `tar -C box -I 'zstd -T0 -q' -cf ${ARCHIVE} ${BOX_CACHE_FOLDER}`,
  `echo "packed $(stat -c %s ${ARCHIVE})"`,
].join('\n')

/** Only the caches' folder comes out of the archive; on any failure the caches are left empty. */
const UNPACK = [
  'set -o pipefail',
  `rm -rf ${CACHE}`,
  `if mkdir -p box && tar -C box -I zstd -xf ${ARCHIVE} ${BOX_CACHE_FOLDER} && test -d ${CACHE} && ${STAMP_OF_CACHE} > ${STAMP}; then rm -f ${ARCHIVE}; exit 0; fi`,
  `rm -rf ${CACHE} ${ARCHIVE} ${STAMP}`,
  'exit 1',
].join('\n')

const failure = (what: string, result: { readonly stdout: string; readonly stderr: string; readonly exitCode: number }): string =>
  `${what}: ${(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`).slice(0, 500)}`

const wsFailure = (op: 'get' | 'put', result: WsRun): string =>
  result.exitCode === 124 ? `ws ${op} ran out of time (${result.seconds} s)` : failure(`ws ${op} failed`, result)

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Put the caches back on a booting Box from the archive of `archiveBytes` bytes in the Workspace (undefined: there is none). Runs before
 * setup.sh. Never rejects: a failure leaves the caches empty and says why.
 */
export async function restoreBoxCache(backend: BoxBackend, permits: CopyPermits, archiveBytes: number | undefined): Promise<BoxCacheRestore> {
  if (archiveBytes === undefined) return { _tag: 'NoArchive' }
  try {
    const fetched = await runWs(backend, permits, 'get', BOX_CACHE_KEY, `${BOX_CACHE_KEY} ${ARCHIVE}`, archiveBytes)
    // ws deletes what it fetched of a file it could not finish.
    if (fetched.exitCode !== 0) return { _tag: 'Cold', reason: wsFailure('get', fetched) }
    const unpacked = await backend.run(UNPACK, BOX_ROOT, ARCHIVE_SECONDS)
    return unpacked.exitCode === 0 ? { _tag: 'Restored', bytes: archiveBytes } : { _tag: 'Cold', reason: failure(`${BOX_CACHE_KEY} did not unpack`, unpacked) }
  } catch (error) {
    return { _tag: 'Cold', reason: reasonOf(error) }
  }
}

/** The answer of PACK. */
type Packed = { readonly _tag: 'none' } | { readonly _tag: 'unchanged' } | { readonly _tag: 'packed'; readonly bytes: number }

function parsePacked(stdout: string): Packed | undefined {
  const line = stdout.trim().split('\n').at(-1) ?? ''
  if (line === 'none' || line === 'unchanged') return { _tag: line }
  const match = /^packed (\d+)$/.exec(line)
  const bytes = match === null ? NaN : Number(match[1])
  return Number.isSafeInteger(bytes) ? { _tag: 'packed', bytes } : undefined
}

/**
 * Keep the caches of a Box about to stop as the archive in the Workspace, unless they did not change since the boot. Never rejects: on a
 * failure the archive in the Workspace stays as it was.
 */
export async function saveBoxCache(backend: BoxBackend, permits: CopyPermits): Promise<BoxCacheSave> {
  try {
    const result = await backend.run(PACK, BOX_ROOT, ARCHIVE_SECONDS)
    const packed = result.exitCode === 0 ? parsePacked(result.stdout) : undefined
    if (packed === undefined) return { _tag: 'NotSaved', reason: failure('the caches did not pack', result) }
    switch (packed._tag) {
      case 'none': return { _tag: 'NoCache' }
      case 'unchanged': return { _tag: 'Unchanged' }
      case 'packed': {
        const sent = await runWs(backend, permits, 'put', BOX_CACHE_KEY, `${ARCHIVE} ${BOX_CACHE_KEY}`, packed.bytes)
        return sent.exitCode === 0 ? { _tag: 'Saved', bytes: packed.bytes } : { _tag: 'NotSaved', reason: wsFailure('put', sent) }
      }
    }
  } catch (error) {
    return { _tag: 'NotSaved', reason: reasonOf(error) }
  }
}
