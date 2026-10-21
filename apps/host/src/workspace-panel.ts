/**
 * What the owner's Workspace panel reads (v1.21 ticket 08, cw-1wrt): a directory of the checkout the Robot works in, and git's state of
 * it. git runs read-only and without the repository's own programs: the file-system monitor off, no optional locks (so status takes no
 * index lock while a Robot works), no pager, no hooks and no external diff; nothing in the repository's config runs.
 */
import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { LIST_DIRECTORY_MAX } from '@mr-robot/host-protocol'

/** git's arguments before the command: the repository's programs off. */
export const SAFE_GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '-c', 'core.pager=cat', '--no-optional-locks', '--no-pager']

/** The environment git gets: the given one, without a config that could run a program, without optional locks. */
const gitEnv = (env: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv => ({ ...(env ?? process.env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' })

/** Run git read-only in a checkout. */
export function git(cwd: string, args: readonly string[], env?: Readonly<Record<string, string>>, command = 'git'): Promise<string> {
  return new Promise((done, fail) => {
    execFile(command, [...SAFE_GIT, ...args], { cwd, env: gitEnv(env), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) fail(Object.assign(new Error(`git ${args[0] ?? ''} failed: ${stderr.trim() || error.message}`), { code: 'GIT_FAILED' }))
      else done(stdout)
    })
  })
}

/** The branch, the status and the last twenty commits of a checkout. */
export async function gitState(checkout: string, env?: Readonly<Record<string, string>>, command = 'git') {
  const status = await git(checkout, ['status', '--porcelain=v1', '--branch', '-z', '--untracked-files=normal'], env, command)
  const records = status.split('\0').filter((record) => record !== '')
  const head = records[0]?.startsWith('## ') === true ? records.shift()!.slice(3) : ''
  const entries: Array<{ code: string; path: string }> = []
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at]!
    const code = record.slice(0, 2)
    entries.push({ code, path: record.slice(3) })
    // A rename or copy carries its old path in the next record.
    if (code.startsWith('R') || code.startsWith('C')) at += 1
  }
  const log = await git(checkout, ['log', '-20', '--format=%H%x1f%s%x1f%an%x1f%ct%x1e'], env, command).catch(() => '')
  return {
    branch: head.split('...')[0] ?? head,
    status: entries,
    log: log.split('\x1e').map((line) => line.trim()).filter((line) => line !== '').map((line) => {
      const [hash = '', subject = '', author = '', at = '0'] = line.split('\x1f')
      return { hash, subject, author, at: Number(at) * 1000 }
    }),
  }
}

/** One directory of a checkout for the panel: directories first, then files, sorted; .git left out; never outside the checkout. */
export async function checkoutFiles(checkout: string, path: string) {
  const full = resolve(checkout, path)
  const from = relative(checkout, full)
  if (from.startsWith('..') || isAbsolute(from)) throw Object.assign(new Error(`${path} is outside the Workspace`), { code: 'EACCES' })
  const listed = (await readdir(full, { withFileTypes: true })).filter((entry) => entry.name !== '.git')
  const entries = await Promise.all(listed.map(async (entry) => {
    const kind = entry.isSymbolicLink() ? 'link' as const : entry.isDirectory() ? 'directory' as const : entry.isFile() ? 'file' as const : 'other' as const
    const size = kind === 'file' ? (await lstat(join(full, entry.name)).catch(() => undefined))?.size ?? null : null
    return { name: entry.name, kind, size }
  }))
  entries.sort((a, b) => (a.kind === 'directory') !== (b.kind === 'directory') ? (a.kind === 'directory' ? -1 : 1) : a.name < b.name ? -1 : 1)
  return { path: from, entries: entries.slice(0, LIST_DIRECTORY_MAX), truncated: entries.length > LIST_DIRECTORY_MAX }
}
