/**
 * DSH's helper programs in an Electron app (deep review P17). subprocess-local starts its process runner as [process.execPath, runner]
 * (under a systemd scope on Linux, under a Win32 job on Windows), and on Windows the sandbox wraps a confined command in the ACL runner,
 * started the same way. In Electron process.execPath is the app itself, which runs a script only when ELECTRON_RUN_AS_NODE is set. The
 * runners take the switch out of their own environment when they start (build.mjs), so the commands they start never see it.
 */

/** Electron's switch: the app's own program runs a script as plain Node. */
export const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

/** The part of DSH's subprocess spec this module reads and writes. */
interface SpawnSpec {
  readonly argv: readonly string[]
  readonly env?: NodeJS.ProcessEnv | undefined
}

/**
 * Let DSH's runners start as Node. subprocess-local builds the runner's environment from this process's own, so the switch is set in it
 * for the length of one synchronous spawn call and taken out at once. The command's environment gets the switch only when the command
 * is this program again (the ACL runner, or a file change that sets it itself); every other command gets none, so a program of the
 * Robot's that is an Electron app runs as itself.
 */
export function startRunnersAsNode<Spec extends SpawnSpec, Handle>(subprocess: { spawn(spec: Spec): Handle }): void {
  const spawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (spec) => {
    const before = process.env[RUN_AS_NODE]
    process.env[RUN_AS_NODE] = '1'
    try {
      return spawn({ ...spec, env: { [RUN_AS_NODE]: spec.argv[0] === process.execPath ? '1' : undefined, ...spec.env } })
    } finally {
      if (before === undefined) delete process.env[RUN_AS_NODE]
      else process.env[RUN_AS_NODE] = before
    }
  }
}
