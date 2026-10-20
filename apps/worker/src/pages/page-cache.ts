/**
 * Pages rendered once per content version (v1.17 review): a Page's HTML document and its PDF are kept in R2 under the Robot's own cache prefix,
 * outside its Workspace, so a popular share link costs R2 reads and not a Markdown render or a Browser Rendering session per view. A version is
 * the Page file's etag with the etags of the Workspace images it inlines: a change to any of them is a new version. The cache is the
 * platform's: Files, glob and grep never see it, and Start over and deletion remove it.
 */
import type { PageFormat } from './page.ts'

export const pageCachePrefix = (robotId: string): string => 'page-cache/' + robotId + '/'

/** A Page as one HTML document, with the content version it was rendered from. */
export interface PageDocument {
  readonly title: string
  readonly html: string
  readonly format: PageFormat
  readonly version: string
}

/** What a rendered document depended on: the Page file and each Workspace image it inlined (null: there was none). */
export interface DocumentSources {
  readonly pageEtag: string
  readonly images: ReadonlyArray<{ readonly path: string; readonly etag: string | null }>
  /** Anything else the document embeds that changes it, such as the address it loads its styles from. */
  readonly salt: string
}

interface StoredDocument extends DocumentSources {
  readonly document: PageDocument
}

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const sha256 = async (text: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

const pathKey = async (robotId: string, path: string): Promise<string> => pageCachePrefix(robotId) + (await sha256(path))

/** The content version of these sources. */
export const versionOf = (sources: DocumentSources): Promise<string> => sha256(JSON.stringify([sources.pageEtag, sources.images, sources.salt]))

/** The cached document when it was rendered from exactly the sources there are now; undefined otherwise. */
export async function cachedDocument(bucket: R2Bucket, robotId: string, path: string, now: { readonly pageEtag: string; readonly salt: string; readonly imageEtag: (path: string) => Promise<string | null> }): Promise<PageDocument | undefined> {
  const object = await bucket.get(await pathKey(robotId, path) + '.json')
  if (object === null) return undefined
  const stored = await object.json<StoredDocument>().catch(() => undefined)
  if (stored === undefined || stored.pageEtag !== now.pageEtag || stored.salt !== now.salt) return undefined
  for (const image of stored.images) if ((await now.imageEtag(image.path)) !== image.etag) return undefined
  return stored.document
}

export async function storeDocument(bucket: R2Bucket, robotId: string, path: string, sources: DocumentSources, document: PageDocument): Promise<void> {
  await bucket.put(await pathKey(robotId, path) + '.json', JSON.stringify({ ...sources, document } satisfies StoredDocument), { httpMetadata: { contentType: 'application/json' } })
}

/** The PDF printed from this version of the Page, if it was printed. */
export async function cachedPdf(bucket: R2Bucket, robotId: string, path: string, version: string): Promise<Uint8Array | undefined> {
  const object = await bucket.get(await pathKey(robotId, path) + '-' + version + '.pdf')
  return object === null ? undefined : new Uint8Array(await object.arrayBuffer())
}

/** Keep the PDF of this version; the PDFs of the Page's earlier versions go. */
export async function storePdf(bucket: R2Bucket, robotId: string, path: string, version: string, pdf: Uint8Array): Promise<void> {
  const base = await pathKey(robotId, path)
  const earlier = (await bucket.list({ prefix: base + '-' })).objects.map((object) => object.key).filter((key) => key !== base + '-' + version + '.pdf')
  if (earlier.length > 0) await bucket.delete(earlier)
  await bucket.put(base + '-' + version + '.pdf', pdf, { httpMetadata: { contentType: 'application/pdf' } })
}

/** Every cached document and PDF of a Robot, for Start over and deletion. */
export async function deletePageCache(bucket: R2Bucket, robotId: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: pageCachePrefix(robotId), ...(cursor === undefined ? {} : { cursor }) })
    if (page.objects.length > 0) await bucket.delete(page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
}
