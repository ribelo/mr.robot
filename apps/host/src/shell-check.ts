/**
 * A check of the Host's shell on a real machine (v1.16 ticket 02, ob-wsf7, ob-xj2y): node dist/shell-check.cjs. It runs a command
 * confined to a Robot directory, a write outside it, a write in an extra root and a full-access write, then a file change of the file
 * tools in the Robot directory and outside it, and prints what the sandbox did. It removes its folders when it ends. On an installed app
 * run it with the app's program as Node: ELECTRON_RUN_AS_NODE=1 <the app> shell-check.cjs (the Nix package has mr-robot-host-shell-check).
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostAccess } from '@mr-robot/host-protocol'
import { errorCode } from './error-code.ts'
import { HostShell } from './shell.ts'

/** The check's own folder in the home directory (the sandbox treats /tmp apart): a home for the Robot, a folder outside, an extra root. */
let folder: string | undefined

async function main(): Promise<void> {
  folder = await mkdtemp(join(homedir(), '.mr-robot-shell-check-'))
  const [home, outside, extra] = ['home', 'outside', 'extra'].map((name) => join(folder!, name)) as [string, string, string]
  for (const directory of [home, outside, extra]) await mkdir(directory)
  const shell = await HostShell.start({ home, landlockLauncher: join(__dirname, 'landlock-run') })
  try {
    await checks(shell, home, outside, extra)
  } finally {
    await shell.dispose()
  }
}

async function checks(shell: HostShell, home: string, outside: string, extra: string): Promise<void> {
  console.log('sandbox on this computer:', shell.sandbox)
  const run = async (label: string, command: string, access: HostAccess) => {
    try {
      const result = await shell.run({ command, access, background: false, job: `check:${label.trim()}` })
      if (result.kind !== 'foreground') throw new Error(`the command did not end: ${result.kind}`)
      console.log(label, JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout.text.trim(), stderr: result.stderr.text.trim(), sandbox: result.sandbox }))
    } catch (error) {
      console.log(label, 'FAILED:', error instanceof Error ? error.message : String(error), errorCode(error))
    }
  }
  const confined: HostAccess = { robot: 'check', mode: 'workspace-write', roots: [] }
  await run('write in the Robot directory:', 'echo hi > note.txt && pwd && cat note.txt', confined)
  await run('write outside the roots:    ', `echo hi > ${outside}/x.txt`, confined)
  await run('write in an extra root:     ', `echo hi > ${extra}/x.txt && echo wrote`, { ...confined, roots: [extra] })
  await run('write under read-only:      ', 'echo hi > note2.txt', { ...confined, mode: 'read-only' })
  await run('read outside (any mode):    ', 'ls /etc | head -n 1', { ...confined, mode: 'read-only' })
  await run('write with full access:     ', `echo hi > ${outside}/y.txt && echo wrote`, { ...confined, mode: 'full' })
  // A file tool's change runs in the same sandbox (file-change.ts); outside the roots the kernel refuses it.
  const change = async (label: string, path: string) => {
    try {
      await shell.change(confined, { _tag: 'Write', path, offset: 0, truncate: true }, new TextEncoder().encode('hi'))
      console.log(label, 'written')
    } catch (error) {
      console.log(label, 'FAILED:', error instanceof Error ? error.message : String(error), errorCode(error))
    }
  }
  await change('file change in the Robot dir:', join(home, 'mr-robot', 'check', 'file.txt'))
  await change('file change outside the roots:', join(outside, 'file.txt'))
}

/** The folder goes whatever happened, also when the check is stopped (Ctrl-C). */
const tidy = async (): Promise<void> => {
  if (folder !== undefined) await rm(folder, { recursive: true, force: true })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void tidy().finally(() => process.exit(130)) })

void main().then(
  () => tidy().then(() => process.exit(0)),
  (error: unknown) => { console.error(error); return tidy().finally(() => process.exit(1)) },
)
