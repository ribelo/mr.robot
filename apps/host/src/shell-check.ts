/**
 * A check of the Host's shell on a real machine (v1.16 ticket 02, ob-wsf7, ob-xj2y): node dist/shell-check.cjs. It runs a command
 * confined to a Robot directory, a write outside it, a write in an extra root and a full-access write, then a file change of the file
 * tools in the Robot directory and outside it, and prints what the sandbox did.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HostAccess } from '@mr-robot/host-protocol'
import { errorCode } from './error-code.ts'
import { HostShell } from './shell.ts'

async function main(): Promise<void> {
  const home = await mkdtemp(join(homedir(), '.mr-robot-shell-check-'))
  const outside = await mkdtemp(join(homedir(), '.mr-robot-shell-outside-'))
  const extra = await mkdtemp(join(homedir(), '.mr-robot-shell-extra-'))
  const shell = await HostShell.start({ home, landlockLauncher: join(__dirname, 'landlock-run') })
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
  await shell.dispose()
  for (const directory of [home, outside, extra]) await rm(directory, { recursive: true, force: true })
}

void main().then(() => process.exit(0), (error: unknown) => { console.error(error); process.exit(1) })
