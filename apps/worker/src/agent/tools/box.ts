/**
 * The Box tools (v1.14 ticket 10, ao-xokp): run a command, read and write files on the Robot's Box.
 * Paths are on the Box, under its /workspace; that disk is scratch except box/, which is kept in the
 * Robot's Workspace.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface BoxHost {
  boxRun(command: string, timeoutSeconds: number): Promise<{ stdout: string; stderr: string; exitCode: number }>
  boxRead(path: string): Promise<string>
  boxWrite(path: string, content: string): Promise<{ written: string; bytes: number }>
}

export const BOX_DEFAULT_TIMEOUT = 120
export const BOX_MAX_TIMEOUT = 1800

export function boxTools(host: BoxHost): ToolDefinition[] {
  return [
    tool<{ command: string; timeoutSeconds?: number }>({
      name: 'box_run',
      description: `Run a bash command on your Box, in /workspace. Returns stdout, stderr and the exit code (124: the time limit, default ${BOX_DEFAULT_TIMEOUT} s, ended it). The Box boots on the first command.`,
      parameters: {
        properties: {
          command: { type: 'string', description: 'The bash command line' },
          timeoutSeconds: { type: 'integer', description: `Time limit in seconds, at most ${BOX_MAX_TIMEOUT}` },
        },
        required: ['command'],
      },
      execute: async ({ command, timeoutSeconds }) => host.boxRun(command, Math.min(BOX_MAX_TIMEOUT, Math.max(1, Math.round(timeoutSeconds ?? BOX_DEFAULT_TIMEOUT)))),
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
