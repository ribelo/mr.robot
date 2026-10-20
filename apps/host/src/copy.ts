/**
 * The Host app's side of copy (v1.16 ticket 06): real files and the real `fetch` for the copy engine of the protocol package.
 */
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CopyFailed, type CopyIo, type SourceFile, type TargetFile } from '@mr-robot/host-protocol'

export const nodeCopyIo: CopyIo = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** The size of a regular file. */
export async function fileSize(full: string): Promise<number> {
  const info = await stat(full)
  if (!info.isFile()) throw new CopyFailed({ message: `${full} is not a file` })
  return info.size
}

/** A file read by ranges, never whole. */
export function sourceFile(full: string): SourceFile {
  return {
    size: () => fileSize(full),
    read: async (offset, length) => {
      const handle = await open(full, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        return buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    },
  }
}

/**
 * A file written beside its place under a temporary name, and moved there when it is whole; nothing half-copied is ever at the path. A
 * download that comes in windows `resume`s the temporary file after the first.
 */
export function targetFile(full: string, options: { readonly resume: boolean }): TargetFile {
  const partial = `${full}.mr-robot-part`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  const opened = async () => {
    if (handle === undefined) {
      await mkdir(dirname(full), { recursive: true })
      handle = await open(partial, options.resume ? 'r+' : 'w')
    }
    return handle
  }
  return {
    write: async (offset, bytes) => { await (await opened()).write(bytes, 0, bytes.length, offset) },
    finish: async () => {
      await (await opened()).close()
      handle = undefined
      await rename(partial, full)
    },
    release: async () => {
      await handle?.close()
      handle = undefined
    },
    abandon: async () => {
      await handle?.close().catch(() => undefined)
      handle = undefined
      await rm(partial, { force: true })
    },
  }
}
