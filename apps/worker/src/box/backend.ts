/**
 * The Box seam (v1.14 ticket 10, ao-33fs): what a Robot needs of its Box, like the browser seam. The
 * Cloudflare Container adapter is the one runtime today; another runtime later is another adapter. Tests use a stub.
 */
import { BACKENDS } from '../browser/backends.ts'
import type { Env } from '../env.ts'

export interface BoxFile {
  /** Relative to the listed directory. */
  readonly path: string
  readonly size: number
  readonly mtime: number
}

export interface BoxBackend {
  start(): Promise<void>
  running(): Promise<boolean>
  run(command: string, cwd: string, timeoutSeconds: number): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  list(directory: string): Promise<readonly BoxFile[]>
  stop(): Promise<void>
}

export class BoxUnavailable extends Error {
  constructor() {
    super('This deployment has no Box for Robots (the container is not deployed).')
  }
}

/** The Robot's container: one per Robot id (ao-8x0c). */
export function containerBox(env: Env, robotId: string): BoxBackend {
  const namespace = env.COMPUTER
  if (namespace === undefined) throw new BoxUnavailable()
  const stub = namespace.getByName(robotId.toLowerCase())
  return {
    start: () => stub.begin(),
    running: () => stub.running(),
    run: (command, cwd, seconds) => stub.run(command, cwd, seconds),
    read: (path) => stub.read(path),
    write: (path, bytes) => stub.write(path, bytes),
    list: (directory) => stub.list(directory),
    stop: () => stub.end(),
  }
}

/** Cloudflare's container rate for the standard instance: the Chrome container's rate (ao-54j2). */
export const BOX_HOURLY_USD = BACKENDS.container.hourlyUsd

export function boxCost(ms: number): number {
  return (Math.max(0, ms) / 3_600_000) * BOX_HOURLY_USD
}
