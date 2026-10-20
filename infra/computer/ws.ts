#!/usr/bin/env bun
/**
 * ws, with the Box's real files and network (the program is ws-core.ts). The image bundles this entry into /usr/local/bin/ws.
 */
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { main, type WsIo } from './ws-core.ts'

const io: WsIo = {
  fetch: (input, init) => fetch(input, init),
  env: process.env,
  size: async (path) => {
    const info = await stat(path).catch(() => undefined)
    return info?.isFile() === true ? info.size : undefined
  },
  read: async (path, offset, length) => {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
  text: async (path) => readFile(path, 'utf8').catch(() => undefined),
  create: async (path) => {
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(path, 'w')
    return {
      write: async (offset, bytes) => { await handle.write(bytes, 0, bytes.length, offset) },
      close: () => handle.close(),
    }
  },
  remove: (path) => rm(path, { force: true }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}

process.exit(await main(process.argv.slice(2), io))
