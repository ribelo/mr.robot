/**
 * The execution surface (v1.16 ticket 01): run, read, write, edit, glob, grep, delete_file, copy, job_list, job_output and job_kill.
 * Every call names its place with a mandatory `on`: workspace (the Workspace in R2; files only), box (the Robot's Box) or the name of
 * one of its owner's computers (a Host). Nothing defaults, and copy names both ends (ob-5fjs, ob-ff4g, ob-9afl). The tools hold no
 * place logic: places/places.ts checks the grants and dispatches.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { readWindow, replaceText } from '../../places/file-ops.ts'
import type { PlaceFiles } from '../../places/files.ts'
import type { JobEntry, RunResult } from '../../places/jobs.ts'
import type { CopyEnd, CopyResult, RunInput } from '../../places/places.ts'
import { tool } from './define.ts'

/** What the tools ask of the Robot's places. */
export interface PlacesHost {
  files(on: string, tool: string): Promise<PlaceFiles>
  run(input: RunInput, signal?: AbortSignal): Promise<RunResult>
  copy(from: CopyEnd, to: CopyEnd): Promise<CopyResult>
  jobList(): JobEntry[]
  jobOutput(id: string, wait: boolean, timeoutMs: number): Promise<unknown>
  jobKill(id: string): Promise<unknown>
}

/** The places the Robot holds a grant on now, to describe them to the model; each call still checks its grant. */
export interface PlacesReach {
  readonly workspace: boolean
  readonly box: boolean
  /** Host names, per facet. */
  readonly hosts: { readonly files: readonly string[]; readonly shell: readonly string[] }
}

export const RUN_DEFAULT_TIMEOUT = 120
export const RUN_MAX_TIMEOUT = 1800
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

/** A path on the place: the Workspace and the Box root at /workspace (the Box's is not the Workspace's); a computer takes an absolute path, or one relative to its home directory. */
const PATH_RULES = 'Paths: on workspace, relative or under /workspace; on box, relative to /workspace on the Box or under it (the Box disk is scratch except box/); on a computer, absolute or relative to its home directory. Your owner\'s files, the docs and the platform skills are in your Workspace only.'

function end(value: unknown, which: 'from' | 'to'): CopyEnd {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (typeof record['on'] !== 'string' || record['on'].trim() === '') throw new Error(`copy: ${which}.on is required: workspace, box or the name of one of your owner's computers.`)
  if (typeof record['path'] !== 'string' || record['path'] === '') throw new Error(`copy: ${which}.path is required and must not be empty.`)
  return { on: record['on'], path: record['path'] }
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
        execute: async ({ on, file_path, offset, limit }) => {
          const content = await (await host.files(on, 'read')).readFile(file_path)
          return 'text' in content ? readWindow(content.path, content.text, offset, limit) : { path: content.path, size: content.size, encoding: 'base64', base64: content.base64 }
        },
      }),
      tool<{ on: string; file_path: string; content: string; encoding?: 'text' | 'base64' }>({
        name: 'write',
        description: `Write a whole file, creating its folders and replacing what was there. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: {
          properties: {
            on: filePlace(reach),
            file_path: { type: 'string', description: 'The file to write' },
            content: { type: 'string', description: 'The complete file content' },
            encoding: { type: 'string', enum: ['text', 'base64'], description: 'How content is written: text (default), or base64 for a binary file' },
          },
          required: ['on', 'file_path', 'content'],
        },
        emptyAllowed: ['content'],
        execute: async ({ on, file_path, content, encoding }) => {
          const written = await (await host.files(on, 'write')).writeFile(file_path, content, encoding ?? 'text')
          return { on, written: written.path, bytes: written.bytes }
        },
      }),
      tool<{ on: string; file_path: string; old_string: string; new_string: string; replace_all?: boolean }>({
        name: 'edit',
        description: `Replace text in a file: old_string must occur exactly once unless replace_all is set. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: {
          properties: {
            on: filePlace(reach),
            file_path: { type: 'string', description: 'The file to change' },
            old_string: { type: 'string', description: 'The exact text to replace' },
            new_string: { type: 'string', description: 'The text that replaces it (empty deletes)' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence; false when left out' },
          },
          required: ['on', 'file_path', 'old_string', 'new_string'],
        },
        emptyAllowed: ['new_string'],
        execute: async ({ on, file_path, old_string, new_string, replace_all }) => {
          const files = await host.files(on, 'edit')
          const content = await files.readFile(file_path)
          if (!('text' in content)) throw new Error(`${content.path} is not a text file, so it cannot be edited`)
          const written = await files.writeFile(file_path, replaceText(content.text, old_string, new_string, replace_all === true), 'text')
          return { on, edited: written.path }
        },
      }),
      tool<{ on: string; path: string }>({
        name: 'delete_file',
        description: `Delete a file. ${filePlaces(reach)} ${PATH_RULES}`,
        parameters: { properties: { on: filePlace(reach), path: { type: 'string', description: 'The file to delete' } }, required: ['on', 'path'] },
        execute: async ({ on, path }) => {
          const removed = await (await host.files(on, 'delete_file')).removeFile(path)
          return { deleted: removed.path }
        },
      }),
      tool<{ on: string; pattern: string }>({
        name: 'glob',
        description: `List the files matching a glob (* within a segment, ** across segments, ?), as an array of paths (empty when none match). On a Box or a computer the paths are those the place prints, .git and node_modules are skipped, and a pattern starts at the directory before its first wildcard. ${filePlaces(reach)}`,
        parameters: { properties: { on: filePlace(reach), pattern: { type: 'string', description: 'The pattern to match' } }, required: ['on', 'pattern'] },
        concurrencySafe: true,
        execute: async ({ on, pattern }) => (await host.files(on, 'glob')).glob(pattern),
      }),
      tool<{ on: string; pattern: string; glob?: string; ignore_case?: boolean; path?: string }>({
        name: 'grep',
        description: `Search text files with a regular expression; returns an array of { path, line, text } (empty when nothing matches). On a computer the expression is a POSIX extended one, and it searches under path (its home directory when left out). ${filePlaces(reach)}`,
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
        execute: async ({ on, pattern, glob, ignore_case, path }) =>
          (await host.files(on, 'grep')).grep({ pattern, ignoreCase: ignore_case === true, ...(glob === undefined ? {} : { glob }), ...(path === undefined ? {} : { path }) }),
      }),
      tool<{ from: CopyEnd; to: CopyEnd }>({
        name: 'copy',
        description: `Copy one file from one place to another, as it is (binary too); the content does not pass through you, so use this, not read and write, for reports, datasets, images and anything large. Both ends name their place; copy overwrites the target. Between the Workspace and a computer, up to 100 MB; between the Workspace and the Box, up to 32 MB; between two computers, or the Box and a computer, copy to the Workspace first. A file copied into your Workspace under box/ is on your Box at its next boot. ${filePlaces(reach)} Returns both paths, the size and the time. ${PATH_RULES}`,
        parameters: { properties: { from: endSchema('The file to copy'), to: endSchema('Where the copy goes') }, required: ['from', 'to'] },
        execute: async ({ from, to }) => host.copy(end(from, 'from'), end(to, 'to')),
      }),
    )
  }
  if (anyShell) {
    const where = [...(reach.box ? ['"box" (your Box, in /workspace)'] : []), ...(reach.hosts.shell.length > 0 ? [`one of your owner's computers by name (${list(reach.hosts.shell)}), in their login shell and environment, as your owner's user`] : [])].join(', ')
    tools.push(
      tool<{ on: string; command: string; cwd?: string; timeout_seconds?: number; run_in_background?: boolean }>({
        name: 'run',
        description: `Run a shell command. Where: ${where}. There is no default: name the place on every call; the Workspace runs no commands. It waits up to timeout_seconds (default ${RUN_DEFAULT_TIMEOUT}, at most ${RUN_MAX_TIMEOUT}) and returns { kind: "foreground", stdout, stderr, exitCode } when the command ended in time. A command that is still going then is not killed: it goes on as a job, and you get { kind: "promoted", jobId, stdout, stderr } with what it printed so far. With run_in_background the job starts at once and you get its jobId. A job that ends wakes you with its exit code and the end of its output, so you can end your Turn while it runs; look at it with job_output, list jobs with job_list, stop one with job_kill. The Box boots on the first command and stays up while a job runs. A command on a computer is stopped after 600 s.`,
        parameters: {
          properties: {
            on: { type: 'string', description: `box or a computer's name. Where: ${where}.` },
            command: { type: 'string', description: 'The shell command line' },
            cwd: { type: 'string', description: 'The directory to run in (default: /workspace on the Box, the home directory of a computer)' },
            timeout_seconds: { type: 'integer', description: `How long to wait before the command goes on as a job, at most ${RUN_MAX_TIMEOUT}` },
            run_in_background: { type: 'boolean', description: 'Start it as a job at once and do not wait; for a server, a watcher or a long script. false when left out' },
          },
          required: ['on', 'command'],
        },
        execute: async ({ on, command, cwd, timeout_seconds, run_in_background }, exec) =>
          host.run({ on, command, ...(cwd === undefined ? {} : { cwd }), seconds: Math.min(RUN_MAX_TIMEOUT, Math.max(1, Math.round(timeout_seconds ?? RUN_DEFAULT_TIMEOUT))), background: run_in_background === true }, exec.signal),
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
        execute: async ({ job_id, wait, timeout_seconds }) => host.jobOutput(job_id, wait === true, Math.round((timeout_seconds ?? JOB_WAIT_DEFAULT_SECONDS) * 1000)),
      }),
      tool<{ job_id: string }>({
        name: 'job_kill',
        description: 'Stop a running job: on the Box TERM to its whole process group, KILL five seconds later; on a computer you let go of it, and it ends at its own limit. Its output so far is kept in spill/jobs/.',
        parameters: { properties: { job_id: { type: 'string', description: 'The job id from run or job_list' } }, required: ['job_id'] },
        execute: async ({ job_id }) => host.jobKill(job_id),
      }),
    )
  }
  return tools
}
