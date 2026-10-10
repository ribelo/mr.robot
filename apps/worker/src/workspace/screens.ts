/**
 * A Robot's screenshots (v1.11, sk-m7t1): objects under a per-Robot system prefix outside the
 * Workspace, named by their time, kept 7 days. Before v1.11 they were Workspace files under screens/;
 * those stay readable until they age out too.
 */
import { screenPrefix, workspacePrefix } from './workspace.ts'

export const SCREEN_KEEP_MS = 7 * 24 * 60 * 60_000
/** The sweep runs at most this often. */
export const SCREEN_SWEEP_EVERY_MS = 24 * 60 * 60_000

/** The file name of a screenshot taken at `at`: the time is part of the name. */
export function screenName(at: number): string {
  return `${new Date(at).toISOString().replace(/[:.]/g, '-')}.png`
}

const NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.png$/

/** When a screenshot was taken, from its name; undefined for a file that is not one (it is never swept). */
export function screenTime(name: string): number | undefined {
  const match = NAME.exec(name)
  if (match === null) return undefined
  const at = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`)
  return Number.isNaN(at) ? undefined : at
}

/** The bare file name of a stored reference (a pre-v1.11 reference is `screens/<name>`). */
export function bareScreenName(reference: string): string {
  return reference.startsWith('screens/') ? reference.slice('screens/'.length) : reference
}

export async function saveScreenshot(bucket: R2Bucket, robotId: string, png: Uint8Array, at: number): Promise<string> {
  const name = screenName(at)
  await bucket.put(screenPrefix(robotId) + name, png, { httpMetadata: { contentType: 'image/png' } })
  return name
}

/** A screenshot's bytes: from the system prefix, else from the Workspace where older ones were saved. */
export async function readScreenshot(bucket: R2Bucket, robotId: string, name: string): Promise<{ body: ArrayBuffer; contentType: string } | undefined> {
  if (name === '' || name.includes('/')) return undefined
  const object = (await bucket.get(screenPrefix(robotId) + name)) ?? (await bucket.get(`${workspacePrefix(robotId)}screens/${name}`))
  if (object === null) return undefined
  return { body: await object.arrayBuffer(), contentType: object.httpMetadata?.contentType ?? 'image/png' }
}

async function keysUnder(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) })
    keys.push(...page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return keys
}

/** R2 deletes at most 1000 keys in one call. */
async function deleteKeys(bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  for (let from = 0; from < keys.length; from += 1000) await bucket.delete(keys.slice(from, from + 1000))
}

/** Delete the screenshots older than 7 days (both homes); returns how many are left. Other files are not touched. */
export async function sweepScreenshots(bucket: R2Bucket, robotId: string, now: number): Promise<number> {
  const homes = [screenPrefix(robotId), `${workspacePrefix(robotId)}screens/`]
  let left = 0
  for (const prefix of homes) {
    const keys = await keysUnder(bucket, prefix)
    const taken = keys.flatMap((key) => { const at = screenTime(key.slice(prefix.length)); return at === undefined ? [] : [{ key, at }] })
    const old = taken.filter((shot) => shot.at < now - SCREEN_KEEP_MS).map((shot) => shot.key)
    await deleteKeys(bucket, old)
    left += taken.length - old.length
  }
  return left
}

/** Every screenshot of a Robot, for Start over and destroy. */
export async function deleteScreenshots(bucket: R2Bucket, robotId: string): Promise<void> {
  await deleteKeys(bucket, await keysUnder(bucket, screenPrefix(robotId)))
}
