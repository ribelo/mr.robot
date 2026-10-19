/**
 * The computer tools (v1.14 ticket 10, ao-xokp): run a command, read and write files on the Robot's computer.
 * Paths are on the computer, under its /workspace; that disk is scratch except computer/, which is kept in the
 * Robot's Workspace.
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface ComputerHost {
  computerRun(command: string, timeoutSeconds: number): Promise<{ stdout: string; stderr: string; exitCode: number }>
  computerRead(path: string): Promise<string>
  computerWrite(path: string, content: string): Promise<{ written: string; bytes: number }>
}

export const COMPUTER_DEFAULT_TIMEOUT = 120
export const COMPUTER_MAX_TIMEOUT = 1800

export function computerTools(host: ComputerHost): ToolDefinition[] {
  return [
    tool<{ command: string; timeoutSeconds?: number }>({
      name: 'computer_run',
      description: `Run a bash command on your computer, in /workspace. Returns stdout, stderr and the exit code (124: the time limit, default ${COMPUTER_DEFAULT_TIMEOUT} s, ended it). The computer boots on the first command.`,
      parameters: {
        properties: {
          command: { type: 'string', description: 'The bash command line' },
          timeoutSeconds: { type: 'integer', description: `Time limit in seconds, at most ${COMPUTER_MAX_TIMEOUT}` },
        },
        required: ['command'],
      },
      execute: async ({ command, timeoutSeconds }) => host.computerRun(command, Math.min(COMPUTER_MAX_TIMEOUT, Math.max(1, Math.round(timeoutSeconds ?? COMPUTER_DEFAULT_TIMEOUT)))),
    }),
    tool<{ path: string }>({
      name: 'computer_read',
      description: 'Read a text file on your computer (a path under /workspace).',
      parameters: { properties: { path: { type: 'string', description: 'Absolute, or relative to /workspace' } }, required: ['path'] },
      execute: async ({ path }) => host.computerRead(path),
    }),
    tool<{ path: string; content: string }>({
      name: 'computer_write',
      description: 'Write a text file on your computer (a path under /workspace). Under /workspace/computer it is kept in your Workspace when your Turn ends.',
      parameters: { properties: { path: { type: 'string', description: 'Absolute, or relative to /workspace' }, content: { type: 'string', description: 'The whole file' } }, required: ['path', 'content'] },
      emptyAllowed: ['content'],
      execute: async ({ path, content }) => host.computerWrite(path, content),
    }),
  ]
}
