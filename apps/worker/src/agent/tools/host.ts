import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { tool } from './define.ts'

export interface HostToolHost {
  hostRead(host: string, path: string): Promise<unknown>
  hostWrite(host: string, path: string, content: string, encoding: 'text' | 'base64'): Promise<unknown>
  hostRun(host: string, command: string, cwd: string | undefined, timeoutSeconds: number | undefined): Promise<unknown>
  hostCopy(host: string, direction: 'to_workspace' | 'to_host', hostPath: string, workspacePath: string): Promise<unknown>
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
      tool<{ host: string; direction: 'to_workspace' | 'to_host'; host_path: string; workspace_path: string }>({
        name: 'host_copy',
        description: `Copy one file between one of your owner's computers (${list(granted.files)}) and your Workspace, in either direction, as it is: binary files too, up to 100 MB. The content does not pass through you, so use this, not host_read and host_write, for reports, datasets, images and anything large. A file copied into your Workspace under box/ is in your Box at its next boot. Returns both paths and the size.`,
        parameters: {
          properties: {
            host: { type: 'string', description: 'host name' },
            direction: { type: 'string', enum: ['to_workspace', 'to_host'], description: 'to_workspace: from the computer into your Workspace; to_host: from your Workspace onto the computer' },
            host_path: { type: 'string', description: 'absolute path on the computer, or relative to the home directory' },
            workspace_path: { type: 'string', description: 'path in your Workspace' },
          },
          required: ['host', 'direction', 'host_path', 'workspace_path'],
        },
        execute: async ({ host: name, direction, host_path, workspace_path }) => {
          if (direction !== 'to_workspace' && direction !== 'to_host') throw new Error('host_copy: direction is to_workspace or to_host.')
          return host.hostCopy(name, direction, host_path, workspace_path)
        },
      }),
      tool<{ host: string; path: string; content: string; encoding?: 'text' | 'base64' }>({
        name: 'host_write',
        description: `Write a file on one of your owner's computers (${list(granted.files)}), creating its folders.`,
        parameters: { properties: { host: { type: 'string', description: 'host name' }, path: { type: 'string', description: 'absolute path, or relative to the home directory' }, content: { type: 'string', description: 'The complete file content' }, encoding: { type: 'string', enum: ['text', 'base64'], description: 'How content is written: text (default) or base64 for binary files' } }, required: ['host', 'path', 'content'] },
        emptyAllowed: ['content'],
        execute: async ({ host: name, path, content, encoding }) => host.hostWrite(name, path, content, encoding ?? 'text'),
      }),
    )
  }
  if (granted.shell.length > 0) {
    tools.push(tool<{ host: string; command: string; cwd?: string; timeout_seconds?: number }>({
      name: 'host_run',
      description: `Run a shell command on one of your owner's computers (${list(granted.shell)}) as your owner's user, in their login shell and environment. Returns stdout, stderr and the exit code.`,
      parameters: { properties: { host: { type: 'string', description: 'host name' }, command: { type: 'string', description: 'The shell command line to run' }, cwd: { type: 'string', description: 'Directory to run in (default: the home directory)' }, timeout_seconds: { type: 'number', description: 'default 120, at most 600' } }, required: ['host', 'command'] },
      execute: async ({ host: name, command, cwd, timeout_seconds }) => host.hostRun(name, command, cwd, timeout_seconds),
    }))
  }
  return tools
}
