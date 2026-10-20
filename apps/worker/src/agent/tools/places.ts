/**
 * The execution surface (v1.16 ticket 01): run, read, write, edit, glob, grep, delete_file, copy, job_list, job_output and job_kill.
 * Every call names its place with a mandatory `on`: workspace (the Workspace in R2; files only), box (the Robot's Box) or the name of
 * one of its owner's computers (a Host). Nothing defaults, and copy names both ends (ob-5fjs, ob-ff4g, ob-9afl). The tools hold no
 * place logic: places/places.ts checks the grants and dispatches.
 */
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { GREP_MAX_MATCHES, LISTING_MAX_FILES, RUN_MAX_WAIT_SECONDS } from '@mr-robot/host-protocol'
import { isWaitingResult, type WaitingResult } from '../ask-gate.ts'
import { isPlaceError, placeErrorText } from '../../places/errors.ts'
import { readWindow, replaceText } from '../../places/file-ops.ts'
import { WORKSPACE_GREP_MAX_FILES, type PlaceFiles } from '../../places/files.ts'
import { parseJobId, type JobId } from '../../places/job-id.ts'
import type { JobEntry, JobOutputView, KillView, RunResult } from '../../places/jobs.ts'
import type { CopyEnd, CopyResult, PlaceCall, RunInput } from '../../places/places.ts'
import { isTransferFailure } from '../../places/transfers.ts'
import { tool } from './define.ts'

/** What the tools ask of the Robot's places. */
export interface PlacesHost {
  /** Do something on the files of a place; a call to a place at ask, or one that asked to escalate, waits for its owner first. */
  withFiles<A>(on: string, call: PlaceCall, action: (files: PlaceFiles) => Promise<A>): Promise<A | WaitingResult>
  run(input: RunInput, call: PlaceCall): Promise<RunResult | WaitingResult>
  copy(from: CopyEnd, to: CopyEnd, call: PlaceCall): Promise<CopyResult | WaitingResult>
  jobList(): JobEntry[]
  jobOutput(id: JobId, wait: boolean, timeoutMs: number, call: PlaceCall): Promise<JobOutputView | WaitingResult>
  jobKill(id: JobId, call: PlaceCall): Promise<KillView | WaitingResult>
}

/**
 * The tool boundary: a refusal of the places is a tagged error (places/errors.ts, places/transfers.ts), and here it becomes the words the
 * Robot reads. Anything else is not ours to word and goes on as it is.
 */
async function guarded<A>(toolName: string, run: () => Promise<A>): Promise<A> {
  try {
    return await run()
  } catch (error) {
    if (isPlaceError(error)) throw new Error(placeErrorText(error, toolName))
    if (isTransferFailure(error)) throw new Error(`${toolName}: ${error.message}`)
    throw error
  }
}

/** The job a tool argument names, or the words that say there is none. */
function jobOf(text: unknown): JobId {
  const id = parseJobId(text)
  if (id === undefined) throw new Error(`no job ${String(text)}; list them with job_list`)
  return id
}

/** One call with its arguments as given: when it waits for the owner, the Ask stores them and the owner's approval runs them again. */
const callOf = (tool: string, args: object, exec: ToolRunContext): PlaceCall =>
  ({ tool, arguments: { ...args }, escalate: 'escalate' in args && args.escalate === true, exec })

const ESCALATE_PARAMETER = { type: 'boolean', description: 'Only after the sandbox of a computer denied this: ask your owner to let it run once without the sandbox. Needs reason. The call does not run now; you are woken with its result or the answer. Computers only' }
const REASON_PARAMETER = { type: 'string', description: 'With escalate: why this needs to reach outside the sandbox, in one sentence; your owner reads it. Also required when your owner approves each use of the files grant' }

/** The places the Robot holds a grant on now, to describe them to the model; each call still checks its grant. */
export interface PlacesReach {
  readonly workspace: boolean
  readonly box: boolean
  /** Host names, per facet. */
  readonly hosts: { readonly files: readonly string[]; readonly shell: readonly string[] }
}

export const RUN_DEFAULT_TIMEOUT = 120
export const RUN_MAX_TIMEOUT = RUN_MAX_WAIT_SECONDS
export const JOB_WAIT_DEFAULT_SECONDS = 30

const list = (names: readonly string[]): string => names.join(', ')

function filePlaces(reach: PlacesReach): string {
  const places = [
    ...(reach.workspace ? ['"workspace" (your Workspace)'] : []),
    ...(reach.box ? ['"box" (your Box)'] : []),
    ...(reach.hosts.files.length > 0 ? [`one of your owner's computers by name (${list(reach.hosts.files)})`] : []),
  ]
  return `Where: ${places.join(', ')}. There is no default: name the place on every call.`
}

const filePlace = (reach: PlacesReach) => ({ type: 'string', description: `workspace, box or a computer's name. ${filePlaces(reach)}` })

/** A path on the place: the Workspace and the Box root at /workspace (the Box's is not the Workspace's); a computer takes an absolute path, ~/ for its home directory, or a path relative to your own directory there (~/mr-robot/<you>/). */
const PATH_RULES = 'Paths: on workspace, relative or under /workspace; on box, relative to /workspace on the Box or under it (the Box disk is scratch except box/); on a computer, absolute, ~/ for its home directory, or relative to your own directory there (~/mr-robot/<you>/, made on first use); reads reach everything your owner\'s user can read, writes only what your grant lets you change. Your owner\'s files, the docs and the platform skills are in your Workspace only.'

function end(value: unknown, which: 'from' | 'to'): CopyEnd {
  const on = value !== null && typeof value === 'object' && 'on' in value ? value.on : undefined
  const path = value !== null && typeof value === 'object' && 'path' in value ? value.path : undefined
  if (typeof on !== 'string' || on.trim() === '') throw new Error(`copy: ${which}.on is required: workspace, box or the name of one of your owner's computers.`)
  if (typeof path !== 'string' || path === '') throw new Error(`copy: ${which}.path is required and must not be empty.`)
  return { on, path }
}

const endSchema = (text: string) => ({
  type: 'object',
  description: text,
  properties: { on: { type: 'string', description: 'workspace, box or a computer\'s name' }, path: { type: 'string', description: 'The file\'s path on that place' } },
  required: ['on', 'path'],
})

export function placesTools(host: PlacesHost, reach: PlacesReach): ToolDefinition[] {
  const anyFiles = reach.workspace || reach.box || reach.hosts.files.length > 0
  const anyShell = reach.box || reach.hosts.shell.length > 0
  const tools: ToolDefinition[] = []
  if (anyFiles) {
    tools.push(
      tool<{ on: string; file_path: string; offset?: number; limit?: number }>({
        name: 'read',
        description: `Read a file. A text file comes back as numbered lines (offset and limit pick a window of at most 2000 lines); a file that is not text comes back as base64. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: {
          properties: { on: filePlace(reach), file_path: { type: 'string', description: 'The file to read' }, offset: { type: 'integer', description: 'The line to start at, from 1' }, limit: { type: 'integer', description: 'How many lines, at most 2000' } },
          required: ['on', 'file_path'],
        },
        concurrencySafe: true,
        execute: (args, exec) => guarded('read', async () => {
          const { on, file_path, offset, limit } = args
          return host.withFiles(on, callOf('read', args, exec), async (files) => {
            const content = await files.readFile(file_path)
            return 'text' in content ? readWindow(content.path, content.text, offset, limit) : { path: content.path, size: content.size, encoding: 'base64', base64: content.base64 }
          })
        }),
      }),
      tool<{ on: string; file_path: string; content: string; encoding?: 'text' | 'base64'; escalate?: boolean; reason?: string }>({
        name: 'write',
        description: `Write a whole file, creating its folders and replacing what was there. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: {
          properties: {
            on: filePlace(reach),
            file_path: { type: 'string', description: 'The file to write' },
            content: { type: 'string', description: 'The complete file content' },
            encoding: { type: 'string', enum: ['text', 'base64'], description: 'How content is written: text (default), or base64 for a binary file' },
            escalate: ESCALATE_PARAMETER,
            reason: REASON_PARAMETER,
          },
          required: ['on', 'file_path', 'content'],
        },
        emptyAllowed: ['content'],
        execute: (args, exec) => guarded('write', async () => {
          const { on, file_path, content, encoding } = args
          const done = await host.withFiles(on, callOf('write', args, exec), (files) => files.writeFile(file_path, content, encoding ?? 'text'))
          return isWaitingResult(done) ? done : { on, written: done.path, bytes: done.bytes }
        }),
      }),
      tool<{ on: string; file_path: string; old_string: string; new_string: string; replace_all?: boolean; escalate?: boolean; reason?: string }>({
        name: 'edit',
        description: `Replace text in a file: old_string must occur exactly once unless replace_all is set. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: {
          properties: {
            on: filePlace(reach),
            file_path: { type: 'string', description: 'The file to change' },
            old_string: { type: 'string', description: 'The exact text to replace' },
            new_string: { type: 'string', description: 'The text that replaces it (empty deletes)' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence; false when left out' },
            escalate: ESCALATE_PARAMETER,
            reason: REASON_PARAMETER,
          },
          required: ['on', 'file_path', 'old_string', 'new_string'],
        },
        emptyAllowed: ['new_string'],
        execute: (args, exec) => guarded('edit', async () => {
          const { on, file_path, old_string, new_string, replace_all } = args
          const done = await host.withFiles(on, callOf('edit', args, exec), async (files) => {
            const content = await files.readFile(file_path)
            if (!('text' in content)) throw new Error(`${content.path} is not a text file, so it cannot be edited`)
            return files.writeFile(file_path, replaceText(content.text, old_string, new_string, replace_all === true), 'text')
          })
          return isWaitingResult(done) ? done : { on, edited: done.path }
        }),
      }),
      tool<{ on: string; path: string; escalate?: boolean; reason?: string }>({
        name: 'delete_file',
        description: `Delete a file. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: { properties: { on: filePlace(reach), path: { type: 'string', description: 'The file to delete' }, escalate: ESCALATE_PARAMETER, reason: REASON_PARAMETER }, required: ['on', 'path'] },
        execute: (args, exec) => guarded('delete_file', async () => {
          const done = await host.withFiles(args.on, callOf('delete_file', args, exec), (files) => files.removeFile(args.path))
          return isWaitingResult(done) ? done : { deleted: done.path }
        }),
      }),
      tool<{ on: string; pattern: string }>({
        name: 'glob',
        description: `List the files matching a glob (* within a segment, ** across segments, ?). Returns { paths, truncated }: the paths (empty when none match), and truncated true when the place stopped listing after ${LISTING_MAX_FILES} files, so some matches may be missing; then narrow the pattern. On a Box or a computer the paths are those the place prints, .git, node_modules and .cache are skipped, and a pattern starts at the directory before its first wildcard. ${filePlaces(reach)}`,
        parameters: { properties: { on: filePlace(reach), pattern: { type: 'string', description: 'The pattern to match' } }, required: ['on', 'pattern'] },
        concurrencySafe: true,
        execute: (args, exec) => guarded('glob', async () => host.withFiles(args.on, callOf('glob', args, exec), (files) => files.glob(args.pattern))),
      }),
      tool<{ on: string; pattern: string; glob?: string; ignore_case?: boolean; path?: string }>({
        name: 'grep',
        description: `Search text files with a regular expression. Returns { matches, truncated }: at most ${GREP_MAX_MATCHES} matches as { path, line, text } (empty when nothing matches), and truncated true when there were more or not every file was searched (the Workspace searches up to ${WORKSPACE_GREP_MAX_FILES} files); then narrow path or glob. The expression is a JavaScript one, on the Box ripgrep's; on a computer it searches under path (your directory there when left out). .git, node_modules and .cache are skipped on a Box or a computer. ${filePlaces(reach)}`,
        parameters: {
          properties: {
            on: filePlace(reach),
            pattern: { type: 'string', description: 'The pattern to match' },
            glob: { type: 'string', description: 'Limit to files matching this glob' },
            ignore_case: { type: 'boolean', description: 'Match upper and lower case alike' },
            path: { type: 'string', description: 'Search only under this directory' },
          },
          required: ['on', 'pattern'],
        },
        concurrencySafe: true,
        execute: (args, exec) => guarded('grep', async () => {
          const { on, pattern, glob, ignore_case, path } = args
          return host.withFiles(on, callOf('grep', args, exec), (files) => files.grep({ pattern, ignoreCase: ignore_case === true, ...(glob === undefined ? {} : { glob }), ...(path === undefined ? {} : { path }) }))
        }),
      }),
      tool<{ from: CopyEnd; to: CopyEnd; escalate?: boolean; reason?: string }>({
        name: 'copy',
        description: `Copy one file from one place to another, as it is (binary too); the content does not pass through you, so use this, not read and write, for reports, datasets, images and anything large. Both ends name their place; copy overwrites the target. There is no size limit: a file goes straight between R2 and the computer or the Box. Between two computers, or the Box and a computer, the file is parked in your Workspace under tmp/ and deleted when the copy ends. A file copied into your Workspace under box/ is on your Box at its next boot. ${filePlaces(reach)} Returns both paths, the size and the time. ${PATH_RULES}`,
        parameters: { properties: { from: endSchema('The file to copy'), to: endSchema('Where the copy goes'), escalate: ESCALATE_PARAMETER, reason: REASON_PARAMETER }, required: ['from', 'to'] },
        execute: (args, exec) => guarded('copy', async () => host.copy(end(args.from, 'from'), end(args.to, 'to'), callOf('copy', args, exec))),
      }),
    )
  }
  if (anyShell) {
    const where = [...(reach.box ? ['"box" (your Box, in /workspace)'] : []), ...(reach.hosts.shell.length > 0 ? [`one of your owner's computers by name (${list(reach.hosts.shell)}), as your owner's user in the shell its entry in the Hosts line of your runtime section names (bash, or pwsh on Windows), starting in your own directory there; the sandbox lets a command change only your directory and the roots your grant lists (or nothing, or everything, by the mode of your grant)`] : [])].join(', ')
    tools.push(
      tool<{ on: string; command: string; cwd?: string; timeout_seconds?: number; run_in_background?: boolean; escalate?: boolean; reason?: string }>({
        name: 'run',
        description: `Run a shell command: bash on the Box, and on a computer the shell the Hosts line of your runtime section names for it. Where: ${where}. There is no default: name the place on every call; the Workspace runs no commands. It waits up to timeout_seconds (default ${RUN_DEFAULT_TIMEOUT}, at most ${RUN_MAX_TIMEOUT}) and returns { kind: "foreground", stdout, stderr, exitCode } when the command ended in time. A command that is still going then is not killed: it goes on as a job, and you get { kind: "promoted", jobId, stdout, stderr } with what it printed so far. With run_in_background the job starts at once and you get its jobId. A job that ends wakes you with its exit code and the end of its output, so you can end your Turn while it runs; look at it with job_output, list jobs with job_list, stop one with job_kill. The Box boots on the first command and stays up while a job runs. A job on a computer lives as long as the Mr. Robot app there runs: if the app restarts or the computer stays away for five minutes, the job is lost and you are woken as failed. When the sandbox denies a write, the result says which path and how to ask for the wider reach: run the same command again with escalate and a reason; your owner is asked once, and the call runs without the sandbox only if they approve.`,
        parameters: {
          properties: {
            on: { type: 'string', description: `box or a computer's name. Where: ${where}.` },
            command: { type: 'string', description: 'The shell command line' },
            cwd: { type: 'string', description: 'The directory to run in (default: /workspace on the Box, your own directory on a computer)' },
            timeout_seconds: { type: 'integer', description: `How long to wait before the command goes on as a job, at most ${RUN_MAX_TIMEOUT}` },
            run_in_background: { type: 'boolean', description: 'Start it as a job at once and do not wait; for a server, a watcher or a long script. false when left out' },
            escalate: { type: 'boolean', description: 'Only after the sandbox denied this command: ask your owner to let it run once without the sandbox. Needs reason. The call does not run now; you are woken with its result or the answer. Computers only' },
            reason: { type: 'string', description: 'With escalate: why the command needs to reach outside the sandbox, in one sentence; your owner reads it. Also required when your owner approves each use of the shell grant' },
          },
          required: ['on', 'command'],
        },
        execute: (args, exec) => guarded('run', async () => {
          const { on, command, cwd, timeout_seconds, run_in_background } = args
          return host.run({ on, command, ...(cwd === undefined ? {} : { cwd }), seconds: Math.min(RUN_MAX_TIMEOUT, Math.max(1, Math.round(timeout_seconds ?? RUN_DEFAULT_TIMEOUT))), background: run_in_background === true }, callOf('run', args, exec))
        }),
      }),
      tool<Record<string, never>>({
        name: 'job_list',
        description: 'List your jobs, on the Box and on your owner\'s computers (commands that went on past the wait, or started in the background): id, place, command, status (running, completed, killed or lost), when they started and ended, the exit code, and where the whole output is once they ended.',
        parameters: { properties: {} },
        concurrencySafe: true,
        execute: async () => ({ jobs: host.jobList() }),
      }),
      tool<{ job_id: string; wait?: boolean; timeout_seconds?: number }>({
        name: 'job_output',
        description: `What a job printed since you last looked, stdout and stderr, with its status and exit code. With wait it waits until the job ends or timeout_seconds (default ${JOB_WAIT_DEFAULT_SECONDS}) pass. Wait only when you need the result now: otherwise end your Turn and you are woken when the job ends. The Box keeps a job only while it is up.`,
        parameters: {
          properties: {
            job_id: { type: 'string', description: 'The job id from run or job_list' },
            wait: { type: 'boolean', description: 'Wait for the job to end; false when left out' },
            timeout_seconds: { type: 'integer', description: `How long to wait, at most 600; default ${JOB_WAIT_DEFAULT_SECONDS}` },
          },
          required: ['job_id'],
        },
        execute: (args, exec) => guarded('job_output', async () => host.jobOutput(jobOf(args.job_id), args.wait === true, Math.round((args.timeout_seconds ?? JOB_WAIT_DEFAULT_SECONDS) * 1000), callOf('job_output', args, exec))),
      }),
      tool<{ job_id: string }>({
        name: 'job_kill',
        description: 'Stop a running job: on the Box TERM to its whole process group, KILL five seconds later; on a computer the app stops it. Its output so far is kept in spill/jobs/.',
        parameters: { properties: { job_id: { type: 'string', description: 'The job id from run or job_list' } }, required: ['job_id'] },
        execute: (args, exec) => guarded('job_kill', async () => host.jobKill(jobOf(args.job_id), callOf('job_kill', args, exec))),
      }),
    )
  }
  return tools
}
