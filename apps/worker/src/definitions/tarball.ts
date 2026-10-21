/**
 * A gzipped ustar archive of a definition's directory (v1.18 ticket 04): "Download definition" gives the admin the files the library
 * repository holds under robots/<slug>/, to commit by hand; the sync then reads them back (library.ts reads the same format).
 */

function header(path: string, size: number, mtime: number): Uint8Array {
  const block = new Uint8Array(512)
  const encoder = new TextEncoder()
  const put = (offset: number, length: number, text: string) => block.set(encoder.encode(text).subarray(0, length), offset)
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0') + '\0'
  const name = encoder.encode(path)
  // ustar keeps a name of up to 100 bytes and a prefix of up to 155: split at a slash.
  let prefix = ''
  let base = path
  if (name.length > 100) {
    const cut = path.lastIndexOf('/', 154)
    prefix = path.slice(0, cut)
    base = path.slice(cut + 1)
  }
  put(0, 100, base)
  put(100, 8, octal(0o644, 8))
  put(108, 8, octal(0, 8))
  put(116, 8, octal(0, 8))
  put(124, 12, octal(size, 12))
  put(136, 12, octal(Math.floor(mtime / 1000), 12))
  put(148, 8, '        ')
  put(156, 1, '0')
  put(257, 6, 'ustar\0')
  put(263, 2, '00')
  put(345, 155, prefix)
  let sum = 0
  for (const byte of block) sum += byte
  put(148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
  return block
}

/** The files under `root/` (for example "robots/accountant"), gzipped; GitHub's tarballs add one directory above, which the sync strips. */
export async function definitionArchive(root: string, files: ReadonlyMap<string, Uint8Array>, mtime: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for (const [path, body] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(header(`${root}/${path}`, body.length, mtime), body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  parts.push(new Uint8Array(1024))
  const tar = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    tar.set(part, at)
    at += part.length
  }
  return new Uint8Array(await new Response(new Response(tar).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
