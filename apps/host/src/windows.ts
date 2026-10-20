/**
 * The Windows side of the Host's shell (v1.16 ticket 04, ob-e68m): PowerShell 7 found and checked, and the two things DSH's
 * restricted-token sandbox needs from an Electron app. DSH starts its helper programs (the process runner and the ACL runner) with
 * process.execPath and a script; in Electron that file is the app itself, which runs a script only when ELECTRON_RUN_AS_NODE is set.
 */
import { execFile } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { candidatePwshPaths } from '@deepseek-ai/dsh-pwsh-local'

/** Where a person installs PowerShell 7 (the page of Microsoft's installer and winget). */
export const PWSH_INSTALL_URL = 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows'

/** The version of PowerShell the Host needs: DSH's pwsh shell is written for 7, and Windows PowerShell 5.1 reads UTF-8 wrongly. */
export const PWSH_MAJOR = 7

export type PwshSearch =
  | { readonly found: true; readonly path: string }
  | { readonly found: false; readonly problem: string }

/** What the owner reads when no PowerShell 7 can be used, with the way to install it. */
export const pwshProblem = (older?: { readonly path: string; readonly major: number }): string => {
  const found = older === undefined ? 'PowerShell 7 is not installed on this computer' : `The PowerShell at ${older.path} is version ${older.major}`
  return `${found}, so robots cannot run commands here. Install PowerShell 7 (${PWSH_INSTALL_URL}, or run: winget install --id Microsoft.PowerShell) and this app picks it up.`
}

/**
 * The first PowerShell 7 among the candidates. Windows PowerShell 5.1 (powershell.exe) is never one of them: DSH would fall back to it,
 * and this app must not. A candidate that exists but runs an older version is named in the problem.
 */
export async function findPwsh7(candidates: readonly string[], majorOf: (path: string) => Promise<number | undefined>): Promise<PwshSearch> {
  let older: { path: string; major: number } | undefined
  for (const path of candidates) {
    const major = await majorOf(path)
    if (major === undefined) continue
    if (major >= PWSH_MAJOR) return { found: true, path }
    older ??= { path, major }
  }
  return { found: false, problem: pwshProblem(older) }
}

const exists = (path: string): boolean => {
  try {
    const stat = lstatSync(path)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** The major version of the pwsh at `path`, asked of the program itself; undefined when it does not run. */
export const pwshMajor = (path: string): Promise<number | undefined> =>
  new Promise((done) => {
    execFile(path, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 20_000, windowsHide: true }, (error, stdout) => {
      const major = Number.parseInt(stdout.trim(), 10)
      done(error === null && Number.isInteger(major) ? major : undefined)
    })
  })

/** PowerShell 7 on this computer: the installed one first, then the ones on PATH (the Store's too). */
export const findInstalledPwsh7 = (): Promise<PwshSearch> =>
  findPwsh7(candidatePwshPaths().filter((path) => !/[\\/]powershell\.exe$/i.test(path) && exists(path)), pwshMajor)

/**
 * A command's text with the Electron switch taken out of its environment. The switch is on while the runners start (below), and the
 * ACL runner passes its environment on to the command; a program of the Robot's that is an Electron app would then run as plain Node.
 */
export const withoutElectronSwitch = (command: string): string => `[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null); ${command}`

/**
 * Let DSH's runners start. subprocess-local starts its runner as [process.execPath, runner.js] with the app's own environment, and the
 * runner starts the ACL runner the same way with the command's environment. The switch is set only for the length of one synchronous
 * spawn call, so no other process of this app (Chromium's renderers) can start while it is set, and it is out of the environment at once.
 */
export function startRunnersAsNode<Spec, Handle>(subprocess: { spawn(spec: Spec): Handle }): void {
  const spawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (spec) => {
    process.env['ELECTRON_RUN_AS_NODE'] = '1'
    try {
      return spawn(spec)
    } finally {
      delete process.env['ELECTRON_RUN_AS_NODE']
    }
  }
}

/** Whether the ACL runner (argv from the sandbox provider) starts and runs a command under its restricted token; the check behind "partial" in the heartbeat. */
export const aclRunnerWorks = (argv: readonly string[]): Promise<boolean> =>
  new Promise((done) => {
    const [program, ...args] = argv
    if (program === undefined) return done(false)
    execFile(program, args, { timeout: 30_000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (error) => done(error === null))
  })
