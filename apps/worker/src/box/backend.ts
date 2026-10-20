/**
 * The Box seam (v1.14 ticket 10, ao-33fs): what a Robot needs of its Box, like the browser seam. The
 * Cloudflare Container adapter is the one runtime today; another runtime later is another adapter. Tests use a stub.
 */
import type { Env } from '../env.ts'

export interface BoxFile {
  /** Relative to the listed directory. */
  readonly path: string
  readonly size: number
  readonly mtime: number
}

/** What a job is doing, as the Box reports it (v1.15 ticket 07). `gone`: its process is not there and left no exit code. */
export type BoxJobStatus = { readonly state: 'running' } | { readonly state: 'exited'; readonly exitCode: number } | { readonly state: 'gone' }

export interface BoxBackend {
  start(): Promise<void>
  running(): Promise<boolean>
  /**
   * Start a command that goes on by itself (v1.15 ticket 07, gb-lnph): its own session, its output in two files. The call returns once
   * the command is started. A job lives as long as the Box does.
   */
  spawn(job: string, command: string, cwd: string): Promise<void>
  status(job: string): Promise<BoxJobStatus>
  /** The output of one stream of a job from a byte offset on (at most 256 KB), and the size of that stream now. */
  output(job: string, stream: 'out' | 'err', offset: number): Promise<{ readonly text: string; readonly bytes: number; readonly size: number }>
  /** TERM to the job's whole session, KILL five seconds later. */
  kill(job: string): Promise<void>
  /** One command; `env` adds variables to its environment only (a copy's permit for ws: never in the command line). */
  run(command: string, cwd: string, timeoutSeconds: number, env?: Readonly<Record<string, string>>): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  /** Delete a file; one that is not there is not an error. */
  remove(path: string): Promise<void>
  /** Every file under `directory`, except those under the folders `pruned` names relative to it (they are not walked). */
  list(directory: string, pruned?: readonly string[]): Promise<readonly BoxFile[]>
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
    spawn: (job, command, cwd) => stub.spawn(job, command, cwd),
    status: (job) => stub.status(job),
    output: (job, stream, offset) => stub.output(job, stream, offset),
    kill: (job) => stub.killJob(job),
    run: (command, cwd, seconds, env) => stub.run(command, cwd, seconds, env),
    read: (path) => stub.read(path),
    write: (path, bytes) => stub.write(path, bytes),
    remove: (path) => stub.remove(path),
    list: (directory, pruned) => stub.list(directory, pruned),
    stop: () => stub.end(),
  }
}

/**
 * Cloudflare's container rate for the standard instance (1 vCPU, 4 GiB, ao-54j2): $0.000020 per vCPU-second + $0.0000025 per GiB-second.
 */
export const BOX_HOURLY_USD = 0.108

export function boxCost(ms: number): number {
  return (Math.max(0, ms) / 3_600_000) * BOX_HOURLY_USD
}
