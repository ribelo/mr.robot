/**
 * The Host app as a service (v1.21 ticket 09, cw-bi6y, cw-y7wy, cw-ixto): the same link, shell, files, Workspaces and language servers as
 * the desktop app, without Electron: no tray, no window, no browser, no sign-in windows, no notifications. One codebase, two entries:
 * main.ts adds the desktop parts to the same modules.
 *
 *   mr-robot-host pair <server> [--name <name>]   pair this computer: prints the link to approve, waits, saves the token
 *   mr-robot-host --service                       serve Robots until stopped (SIGTERM or SIGINT: a graceful stop with a notice)
 */
import { hostname } from 'node:os'
import { ConfigFile, defaultConfigDirectory, normalizeServer, type HostConfig } from './config.ts'
import { HostChrome } from './chrome.ts'
import { HostLink, startPairing, waitForApproval } from './connection.ts'
import { HostShell } from './shell.ts'
import { join } from 'node:path'

export const VERSION = '0.1.0'

const USAGE = `Usage:
  mr-robot-host pair <server> [--name <name>]   Pair this computer with a Mr. Robot server.
  mr-robot-host --service                       Serve Robots as a service (no window, no display).
`

/** What one run of the service entry does, from its arguments. */
export type ServiceCommand =
  | { readonly kind: 'pair'; readonly server: string; readonly name: string | undefined }
  | { readonly kind: 'serve' }
  | { readonly kind: 'usage'; readonly problem: string | undefined }

export function parseArguments(args: readonly string[]): ServiceCommand {
  if (args[0] === 'pair') {
    const server = args[1]
    if (server === undefined || server.startsWith('-')) return { kind: 'usage', problem: 'pair needs the server address, for example: mr-robot-host pair robots.example.com' }
    const at = args.indexOf('--name')
    return { kind: 'pair', server, name: at === -1 ? undefined : args[at + 1] }
  }
  if (args.includes('--service')) return { kind: 'serve' }
  return { kind: 'usage', problem: args.length === 0 || args.includes('--help') ? undefined : `unknown arguments: ${args.join(' ')}` }
}

interface Io {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  readonly configDirectory: string
}

/** Pair from a terminal: print the code and the link, wait for the Member's approval, save the token. */
async function pair(io: Io, server: string, name: string | undefined): Promise<number> {
  const file = ConfigFile.in(io.configDirectory)
  const config = file.read(hostname())
  const address = normalizeServer(server)
  const named = name ?? config.name
  const pairing = await startPairing(address, named)
  io.out(`Approve this computer ("${named}") as the Member it belongs to:`)
  io.out(`  ${pairing.approveUrl}`)
  io.out(`  code ${pairing.code}`)
  io.out('Waiting for the approval…')
  const paired = await waitForApproval(address, pairing.code, () => false)
  file.write({ ...config, server: address, name: named, hostId: paired.hostId, token: paired.token })
  io.out(`Paired as ${paired.hostId}. Start the service: mr-robot-host --service`)
  return 0
}

/** Serve until a stop signal: the link with its heartbeat, the shell, the Workspaces; a stop tells the Worker first. */
async function serve(io: Io, signals: NodeJS.EventEmitter): Promise<number> {
  const config: HostConfig = ConfigFile.in(io.configDirectory).read(hostname())
  if (config.server === null || config.hostId === null || config.token === null) {
    io.err(`This computer is not paired: run mr-robot-host pair <server> first (config: ${join(io.configDirectory, 'host.json')}).`)
    return 2
  }
  const shell = await HostShell.start({ environment: config.environment, configDirectory: io.configDirectory, landlockLauncher: join(__dirname, 'landlock-run') })
  await shell.recheck()
  if (shell.problem !== undefined) io.err(`The shell is not ready: ${shell.problem}`)
  // A service has no browser: Chrome is never started (cw-ixto).
  const chrome = new HostChrome(join(io.configDirectory, 'chrome-profile'))
  const link = new HostLink({ server: config.server, hostId: config.hostId, token: config.token, version: VERSION, service: true }, shell, chrome, {
    state: (state, detail) => io.out(`${new Date().toISOString()} ${state}${detail === undefined ? '' : `: ${detail}`}`),
    paired: () => undefined,
    unpaired: () => io.err('This computer was unpaired on the server; pair it again to serve Robots.'),
    sessions: () => undefined,
    notify: () => undefined,
  })
  link.start()
  const stop = await new Promise<string>((done) => {
    signals.once('SIGTERM', () => done('SIGTERM'))
    signals.once('SIGINT', () => done('SIGINT'))
  })
  io.out(`${stop}: stopping; the Robots' jobs here end.`)
  await link.stopService()
  await shell.dispose()
  return 0
}

/** One run of the service entry; the exit code. */
export async function runService(args: readonly string[], io: Io, signals: NodeJS.EventEmitter = process): Promise<number> {
  const command = parseArguments(args)
  try {
    if (command.kind === 'pair') return await pair(io, command.server, command.name)
    if (command.kind === 'serve') return await serve(io, signals)
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  }
  if (command.problem !== undefined) io.err(command.problem)
  io.out(USAGE)
  return command.problem === undefined ? 0 : 64
}

// Run as the program (the service bundle), not when a test imports the module.
if (require.main === module) {
  void runService(process.argv.slice(2), { out: (line) => console.log(line), err: (line) => console.error(line), configDirectory: defaultConfigDirectory() }).then((code) => process.exit(code))
}
