import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface HostToolHost {
  hostRead(host: string, path: string): Promise<unknown>
  hostWrite(host: string, path: string, content: string, encoding: 'text' | 'base64'): Promise<unknown>
  hostRun(host: string, command: string, cwd: string | undefined, timeoutSeconds: number | undefined): Promise<unknown>
}

/** Host tools (v1.2 ticket 02, hs-n34u): files and a shell on the owner's computers this Robot is granted. */
export function hostTools(host: HostToolHost, granted: { files: readonly string[]; shell: readonly string[] }): ToolDefinition[] {
  const list = (names: readonly string[]) => (names.length === 0 ? 'none' : names.join(', '))
  const tools: ToolDefinition[] = []
  if (granted.files.length > 0) {
    tools.push(
      tool<{ host: string; path: string }>({
        name: 'host_read',
        description: `Read a file on one of your owner's computers (${list(granted.files)}), as your owner's user. Text comes back as text, other files as base64.`,
        parameters: { properties: { host: { type: 'string', description: 'host name' }, path: { type: 'string', description: 'absolute path, or relative to the home directory' } }, required: ['host', 'path'] },
        execute: async ({ host: name, path }) => host.hostRead(name, path),
      }),
      tool<{ host: string; path: string; content: string; encoding?: 'text' | 'base64' }>({
        name: 'host_write',
        description: `Write a file on one of your owner's computers (${list(granted.files)}), creating its folders.`,
        parameters: { properties: { host: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', enum: ['text', 'base64'] } }, required: ['host', 'path', 'content'] },
        execute: async ({ host: name, path, content, encoding }) => host.hostWrite(name, path, content, encoding ?? 'text'),
      }),
    )
  }
  if (granted.shell.length > 0) {
    tools.push(tool<{ host: string; command: string; cwd?: string; timeout_seconds?: number }>({
      name: 'host_run',
      description: `Run a shell command on one of your owner's computers (${list(granted.shell)}) as your owner's user, in their login shell and environment. Returns stdout, stderr and the exit code.`,
      parameters: { properties: { host: { type: 'string' }, command: { type: 'string' }, cwd: { type: 'string' }, timeout_seconds: { type: 'number', description: 'default 120, at most 600' } }, required: ['host', 'command'] },
      execute: async ({ host: name, command, cwd, timeout_seconds }) => host.hostRun(name, command, cwd, timeout_seconds),
    }))
  }
  return tools
}
