/**
 * The Box tools (v1.14 ticket 10, ao-xokp): run a command, read and write files on the Robot's Box.
 * Paths are on the Box, under its /workspace; that disk is scratch except box/, which is kept in the
 * Robot's Workspace.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface BoxHost {
  boxRun(command: string, timeoutSeconds: number, background: boolean, signal?: AbortSignal): Promise<unknown>
  boxJobs(): Promise<unknown>
  boxJobOutput(jobId: string, wait: boolean, timeoutMs: number): Promise<unknown>
  boxJobKill(jobId: string): Promise<unknown>
  boxRead(path: string): Promise<string>
  boxWrite(path: string, content: string): Promise<{ written: string; bytes: number }>
}

export const BOX_DEFAULT_TIMEOUT = 120
export const BOX_MAX_TIMEOUT = 1800
export const BOX_WAIT_DEFAULT_SECONDS = 30

export function boxTools(host: BoxHost): ToolDefinition[] {
  return [
    tool<{ command: string; timeoutSeconds?: number; run_in_background?: boolean }>({
      name: 'box_run',
      description: `Run a bash command on your Box, in /workspace. It waits up to timeoutSeconds (default ${BOX_DEFAULT_TIMEOUT}, at most ${BOX_MAX_TIMEOUT}) and returns { kind: "foreground", stdout, stderr, exitCode } when the command ended in time. A command that is still going then is not killed: it goes on as a job, and you get { kind: "promoted", jobId, stdout, stderr } with what it printed so far. With run_in_background the job starts at once and you get its jobId. A job that ends wakes you with its exit code and the end of its output, so you can end your Turn while it runs; look at it with job_output, list jobs with job_list, stop one with job_kill. The Box boots on the first command and stays up while a job runs.`,
      parameters: {
        properties: {
          command: { type: 'string', description: 'The bash command line' },
          timeoutSeconds: { type: 'integer', description: `How long to wait before the command goes on as a job, at most ${BOX_MAX_TIMEOUT}` },
          run_in_background: { type: 'boolean', description: 'Start it as a job at once and do not wait; for a server, a watcher or a long script. false when left out' },
        },
        required: ['command'],
      },
      execute: async ({ command, timeoutSeconds, run_in_background }, exec) => host.boxRun(command, Math.min(BOX_MAX_TIMEOUT, Math.max(1, Math.round(timeoutSeconds ?? BOX_DEFAULT_TIMEOUT))), run_in_background === true, exec.signal),
    }),
    tool<Record<string, never>>({
      name: 'job_list',
      description: 'List the jobs of your Box (commands that went on past the wait, or started in the background): id, command, status (running, completed, killed or lost), when they started and ended, the exit code, and where the whole output is once they ended.',
      parameters: { properties: {} },
      concurrencySafe: true,
      execute: async () => ({ jobs: await host.boxJobs() }),
    }),
    tool<{ job_id: string; wait?: boolean; timeout_seconds?: number }>({
      name: 'job_output',
      description: `What a job printed since you last looked, stdout and stderr, with its status and exit code. With wait it waits until the job ends or timeout_seconds (default ${BOX_WAIT_DEFAULT_SECONDS}) pass. Wait only when you need the result now: otherwise end your Turn and you are woken when the job ends. The Box keeps a job only while it is up.`,
      parameters: {
        properties: {
          job_id: { type: 'string', description: 'The job id from box_run or job_list' },
          wait: { type: 'boolean', description: 'Wait for the job to end; false when left out' },
          timeout_seconds: { type: 'integer', description: `How long to wait, at most 600; default ${BOX_WAIT_DEFAULT_SECONDS}` },
        },
        required: ['job_id'],
      },
      execute: async ({ job_id, wait, timeout_seconds }) => host.boxJobOutput(job_id, wait === true, Math.round((timeout_seconds ?? BOX_WAIT_DEFAULT_SECONDS) * 1000)),
    }),
    tool<{ job_id: string }>({
      name: 'job_kill',
      description: 'Stop a running job: TERM to its whole process group, KILL five seconds later. Its output so far is kept in spill/jobs/.',
      parameters: { properties: { job_id: { type: 'string', description: 'The job id from box_run or job_list' } }, required: ['job_id'] },
      execute: async ({ job_id }) => host.boxJobKill(job_id),
    }),
    tool<{ path: string }>({
      name: 'box_read',
      description: 'Read a text file on your Box (a path under /workspace).',
      parameters: { properties: { path: { type: 'string', description: 'Absolute, or relative to /workspace' } }, required: ['path'] },
      execute: async ({ path }) => host.boxRead(path),
    }),
    tool<{ path: string; content: string }>({
      name: 'box_write',
      description: 'Write a text file on your Box (a path under /workspace). Under /workspace/box it is kept in your Workspace when your Turn ends.',
      parameters: { properties: { path: { type: 'string', description: 'Absolute, or relative to /workspace' }, content: { type: 'string', description: 'The whole file' } }, required: ['path', 'content'] },
      emptyAllowed: ['content'],
      execute: async ({ path, content }) => host.boxWrite(path, content),
    }),
  ]
}
