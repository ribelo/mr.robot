/**
 * Every change a file RPC makes on this computer (v1.16 deep review P1): a write, an edit, a delete, a download's part file and its
 * move into place. Each one runs as a small Node program inside DSH's sandbox, under the same mode and roots as the Robot's commands, so
 * the kernel confines it: a link or a swapped directory on the path cannot lead it out of the write roots, whatever happens between the
 * app's check of the path and the change. The bytes go to the program on its stdin; it answers with one line of JSON on its stdout.
 */
import type { Context } from '@deepseek-ai/cordis'
import { classifyRunnerFailure, matchesSignature, SANDBOX_UNAVAILABLE as DSH_SANDBOX_UNAVAILABLE, type SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { SANDBOX_UNAVAILABLE, type HostAccess } from '@mr-robot/host-protocol'
import { WriteDenied, writeRoots } from './access.ts'
import { errorCode } from './error-code.ts'

/** One change of the files of this computer. Paths are absolute. */
export type FileChange =
  /** Write the bytes at `offset`, making the directories on the way; `truncate` starts the file anew, else it must exist. */
  | { readonly _tag: 'Write'; readonly path: string; readonly offset: number; readonly truncate: boolean }
  /** Move a file (or a link itself) to another name. */
  | { readonly _tag: 'Rename'; readonly from: string; readonly to: string }
  /** Delete a file or a link itself, never a directory; a missing one fails with ENOENT unless `missing` is 'ignore'. */
  | { readonly _tag: 'Remove'; readonly path: string; readonly missing: 'fail' | 'ignore' }

/** Who makes the changes: the Host's shell, which owns DSH's sandbox (shell.ts). */
export interface FileChanges {
  /** The OS user's home directory, where the Robots' directories are. */
  readonly home: string
  /**
   * Make one change under the mode and roots of `access`.
   * @throws WriteDenied when the sandbox refused it, an error with code SANDBOX_UNAVAILABLE when nothing here can confine it, and an
   *   error with the OS code (ENOENT, EISDIR, ...) when it failed otherwise.
   */
  change(access: HostAccess, change: FileChange, body?: Uint8Array): Promise<void>
}

/**
 * The program, run with `node -e` (Electron runs as Node with ELECTRON_RUN_AS_NODE). Its last argument is the change as base64 JSON, so
 * no path is ever read as an option or split by a command line; the source has no double quotes or backslashes for the same reason.
 */
const PROGRAM = [
  "const fs = require('node:fs');",
  "const { dirname } = require('node:path');",
  "const change = JSON.parse(Buffer.from(process.argv[process.argv.length - 1], 'base64').toString('utf8'));",
  // One directory at a time, not mkdirSync's recursive form: that one reports ENOENT where the sandbox refused a directory on the way.
  'const makeDirectories = (directory) => {',
  '  try { fs.mkdirSync(directory); } catch (error) {',
  "    if (error.code === 'EEXIST') return;",
  "    if (error.code !== 'ENOENT' || dirname(directory) === directory) throw error;",
  '    makeDirectories(dirname(directory));',
  "    try { fs.mkdirSync(directory); } catch (again) { if (again.code !== 'EEXIST') throw again; }",
  '  }',
  '};',
  'const make = (body) => {',
  "  if (change._tag === 'Write') {",
  '    makeDirectories(dirname(change.path));',
  "    const fd = fs.openSync(change.path, change.truncate ? 'w' : 'r+');",
  '    try { for (let at = 0; at < body.length;) at += fs.writeSync(fd, body, at, body.length - at, change.offset + at); } finally { fs.closeSync(fd); }',
  "  } else if (change._tag === 'Rename') {",
  '    fs.renameSync(change.from, change.to);',
  '  } else {',
  '    let info;',
  "    try { info = fs.lstatSync(change.path); } catch (error) { if (error.code === 'ENOENT' && change.missing === 'ignore') return; throw error; }",
  "    if (info.isDirectory()) throw Object.assign(new Error('EISDIR: a directory is not deleted'), { code: 'EISDIR' });",
  '    fs.unlinkSync(change.path);',
  '  }',
  '};',
  'const chunks = [];',
  "process.stdin.on('data', (chunk) => chunks.push(chunk));",
  "process.stdin.on('end', () => {",
  '  let answer = { ok: true };',
  "  try { make(Buffer.concat(chunks)); } catch (error) { answer = { ok: false, code: typeof error.code === 'string' ? error.code : 'EIO', message: String(error.message) }; }",
  '  process.stdout.write(JSON.stringify(answer));',
  '});',
].join(' ')

type Answer = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }

/** The program's answer; undefined when it printed none (it did not run, or died). */
function parseAnswer(text: string): Answer | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || !('ok' in value)) return undefined
  if (value.ok === true) return { ok: true }
  return 'code' in value && typeof value.code === 'string' && 'message' in value && typeof value.message === 'string' ? { ok: false, code: value.code, message: value.message } : undefined
}

/** The path a change is about, for the messages. */
const subject = (change: FileChange): string => (change._tag === 'Rename' ? change.to : change.path)

const OUTPUT = { maxBytes: 64 * 1024 }

/** Where a change runs: the Robot's directory (its cwd) and the policy its commands run under; home and access word a denial. */
export interface ChangePlace {
  readonly home: string
  readonly access: HostAccess
  readonly directory: string
  readonly policy: SandboxExecutionPolicy & { readonly extraRoots?: readonly string[] }
}

/**
 * Run one change in the sandbox the policy names (none in full mode). The caller has made the directory and the roots the policy binds.
 * @throws as FileChanges.change says.
 */
export async function runFileChange(ctx: Context, place: ChangePlace, change: FileChange, body: Uint8Array = new Uint8Array()): Promise<void> {
  const argv = [process.execPath, '-e', PROGRAM, '--', Buffer.from(JSON.stringify(change), 'utf8').toString('base64')]
  const { policy } = place
  const target = subject(change)
  let confined: Awaited<ReturnType<Context['sandbox']['confine']>> | undefined
  if (policy.mode !== 'danger-full-access') {
    try {
      confined = await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode })
    } catch (error) {
      // No sandbox here, or one that cannot take the grant's extra roots: the change fails closed, as a command does.
      if (errorCode(error) === DSH_SANDBOX_UNAVAILABLE) throw Object.assign(new Error(`${target} was not changed: ${error instanceof Error ? error.message : String(error)}`), { code: SANDBOX_UNAVAILABLE })
      throw error
    }
  }
  const handle = ctx.subprocess.spawn({
    argv: confined?.argv ?? argv,
    cwd: place.directory,
    stdio: { stdin: 'pipe', stdout: OUTPUT, stderr: OUTPUT },
    graceMs: 3000,
    // The program is Node in Electron too; the app's own Node options (a loader, a debugger) do not reach it.
    env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined },
  })
  // A program that died early (a runner that did not start) closes its stdin; its outcome says why, not the broken pipe.
  handle.stdin?.on('error', () => undefined)
  handle.stdin?.end(body)
  const outcome = await handle.done
  const answer = parseAnswer(handle.collected.stdout?.readFrom(0).text ?? '')
  if (answer?.ok === true) return
  if (answer === undefined) {
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    const runnerFailure = confined === undefined ? undefined : classifyRunnerFailure(outcome.exitCode, stderr, confined.runnerFailureRules)
    if (runnerFailure !== undefined) throw Object.assign(new Error(`${target} was not changed: this computer's sandbox did not start (${runnerFailure.detail}).`), { code: SANDBOX_UNAVAILABLE })
    throw new Error(`${target} was not changed: the program that changes files ended without an answer (exit ${outcome.exitCode ?? outcome.signal}): ${stderr.trim()}`)
  }
  // The selected backend's own words for a denied file effect (EROFS under bubblewrap, EACCES under Landlock, EPERM under Seatbelt).
  if (confined !== undefined && matchesSignature(1, answer.message, confined.denialSignatures)) {
    throw new WriteDenied({ message: `${target} was not changed: the sandbox refused it (${answer.code}). The path, or a link or directory on the way to it, leads outside the directories this grant lets you change (${writeRoots(place.home, place.access).join(', ')}).` })
  }
  throw Object.assign(new Error(answer.message), { code: answer.code })
}
