/**
 * The Host app's side of copy (v1.16 ticket 06): real files and the real `fetch` for the copy engine of the protocol package.
 */
import { open, stat } from 'node:fs/promises'
import { CopyFailed, type CopyIo, type SourceFile, type TargetFile } from '@mr-robot/host-protocol'
import type { FileChange } from './file-change.ts'

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
 * download that comes in windows `resume`s the temporary file after the first. Every write, the move and the clean-up are changes made
 * through `change`, so they run in the sandbox of the grant (file-change.ts): a link planted at the temporary name leads nowhere.
 */
export function targetFile(full: string, options: { readonly resume: boolean }, change: (change: FileChange, body?: Uint8Array) => Promise<void>): TargetFile {
  const partial = `${full}.mr-robot-part`
  // The first write of a fresh download starts the temporary file anew; every later one, and every one of a resumed download, adds to it.
  let started = options.resume
  const write = async (offset: number, bytes: Uint8Array) => {
    await change({ _tag: 'Write', path: partial, offset, truncate: !started }, bytes)
    started = true
  }
  return {
    write,
    finish: async () => {
      if (!started) await write(0, new Uint8Array())
      await change({ _tag: 'Rename', from: partial, to: full })
    },
    release: async () => undefined,
    abandon: () => change({ _tag: 'Remove', path: partial, missing: 'ignore' }),
  }
}
