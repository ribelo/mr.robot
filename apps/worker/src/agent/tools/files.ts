/**
 * File tools over the Robot's Workspace in R2 (robot-8pqy). The owner's Member files
 * appear at the Workspace root read-only; editing them is a proposal (robot-jpzp).
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MEMBER_FILE_NAMES, type MemberFileName } from '../../member/member.ts'
import { normalizePath } from '../../workspace/workspace.ts'
import type { RobotHost, WorkspaceHost } from '../host.ts'
import { tool } from './define.ts'

const MAX_READ_CHARS = 200_000
const MAX_GREP_MATCHES = 200

function memberFileName(path: string): MemberFileName | undefined {
  const normalized = normalizePath(path)
  return MEMBER_FILE_NAMES.find((name) => name === normalized)
}

const READ_ONLY = (name: string) => `${name} belongs to your owner and is read-only to you. To change it, call propose_member_file_edit with the full new content; your owner approves or rejects it.`

function isText(contentType: string, path: string): boolean {
  return contentType.startsWith('text/') || contentType.includes('json') || /\.(md|txt|csv|json|html|xml|ya?ml|ts|js|log)$/i.test(path)
}

export function fileTools(host: WorkspaceHost): ToolDefinition[] {
  const ws = host.workspace
  const readText = async (path: string): Promise<string | undefined> => {
    const member = memberFileName(path)
    if (member !== undefined) return host.memberFile(member)
    return host.run(ws.readText(path))
  }
  return [
    tool<{ path: string; offset?: number; limit?: number }>({
      name: 'read_file',
      description: 'Read a file from your Workspace. Text files return their content (optionally a line range); other files return their size and type.',
      parameters: {
        properties: {
          path: { type: 'string', description: 'Workspace path, e.g. MEMORY.md or memory/2026-10-06.md' },
          offset: { type: 'integer', description: 'First line, 1-based' },
          limit: { type: 'integer', description: 'Number of lines' },
        },
        required: ['path'],
      },
      concurrencySafe: true,
      execute: async ({ path, offset, limit }) => {
        const member = memberFileName(path)
        if (member !== undefined) return slice(await host.memberFile(member), offset, limit)
        const file = await host.run(ws.read(path))
        if (file === undefined) throw new Error(`${path} does not exist`)
        if (!isText(file.contentType, path)) return { path: file.path, size: file.size, contentType: file.contentType, note: 'binary file; not shown as text' }
        return slice(new TextDecoder().decode(file.body), offset, limit)
      },
    }),
    tool<{ path: string; content: string }>({
      name: 'write_file',
      description: 'Create or replace a text file in your Workspace.',
      parameters: { properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      execute: async ({ path, content }) => {
        const member = memberFileName(path)
        if (member !== undefined) throw new Error(READ_ONLY(member))
        const entry = await host.run(ws.write(path, content))
        return { written: entry.path, bytes: entry.size }
      },
    }),
    tool<{ path: string; old_string: string; new_string: string; replace_all?: boolean }>({
      name: 'edit_file',
      description: 'Replace exact text in a Workspace file. old_string must match exactly once unless replace_all is true.',
      parameters: {
        properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } },
        required: ['path', 'old_string', 'new_string'],
      },
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const member = memberFileName(path)
        if (member !== undefined) throw new Error(READ_ONLY(member))
        const text = await host.run(ws.readText(path))
        if (text === undefined) throw new Error(`${path} does not exist`)
        const count = old_string === '' ? 0 : text.split(old_string).length - 1
        if (count === 0) throw new Error('old_string was not found')
        if (count > 1 && replace_all !== true) throw new Error(`old_string occurs ${count} times; add context or set replace_all`)
        const next = replace_all === true ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string)
        await host.run(ws.write(path, next))
        return { edited: normalizePath(path), replacements: replace_all === true ? count : 1 }
      },
    }),
    tool<{ path: string }>({
      name: 'delete_file',
      description: 'Delete a file from your Workspace.',
      parameters: { properties: { path: { type: 'string' } }, required: ['path'] },
      execute: async ({ path }) => {
        const member = memberFileName(path)
        if (member !== undefined) throw new Error(READ_ONLY(member))
        await host.run(ws.remove(path))
        return { deleted: normalizePath(path) }
      },
    }),
    tool<{ pattern: string }>({
      name: 'glob',
      description: 'List Workspace files matching a glob (* within a segment, ** across segments, ?). Use "**" to list everything.',
      parameters: { properties: { pattern: { type: 'string' } }, required: ['pattern'] },
      concurrencySafe: true,
      execute: async ({ pattern }) => {
        const matcher = globToRegExp(pattern)
        const entries = await host.run(ws.list())
        const paths = [...MEMBER_FILE_NAMES, ...entries.map((entry) => entry.path)].filter((path) => matcher.test(path)).sort()
        return paths.length === 0 ? 'No files match.' : paths.join('\n')
      },
    }),
    tool<{ pattern: string; glob?: string; ignore_case?: boolean }>({
      name: 'grep',
      description: 'Search text files in your Workspace with a regular expression; returns path:line: text.',
      parameters: {
        properties: { pattern: { type: 'string' }, glob: { type: 'string', description: 'Limit to files matching this glob' }, ignore_case: { type: 'boolean' } },
        required: ['pattern'],
      },
      concurrencySafe: true,
      execute: async ({ pattern, glob, ignore_case }) => {
        const regex = new RegExp(pattern, ignore_case === true ? 'i' : '')
        const files = glob === undefined ? undefined : globToRegExp(glob)
        const entries = await host.run(ws.list())
        const paths = [...MEMBER_FILE_NAMES, ...entries.filter((entry) => entry.size <= 1_000_000).map((entry) => entry.path)]
          .filter((path) => files === undefined || files.test(path))
        const matches: string[] = []
        for (const path of paths) {
          if (matches.length >= MAX_GREP_MATCHES) break
          const text = await readText(path)
          if (text === undefined || text.includes('\u0000')) continue
          for (const [index, line] of text.split('\n').entries()) {
            if (regex.test(line)) matches.push(`${path}:${index + 1}: ${line.slice(0, 300)}`)
            if (matches.length >= MAX_GREP_MATCHES) break
          }
        }
        return matches.length === 0 ? 'No matches.' : matches.join('\n')
      },
    }),
  ]
}

/** Proposing an edit to the owner's Member files (robot-jpzp). */
export function memberFileTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<{ file: string; content: string; purpose: string }>({
      name: 'propose_member_file_edit',
      description: "Propose a new full version of your owner's USER.md or PROACTIVE_PREFERENCES.md, with what you learned. Your owner approves or rejects it.",
      parameters: {
        properties: {
          file: { type: 'string', enum: [...MEMBER_FILE_NAMES] },
          content: { type: 'string', description: 'The complete new file' },
          purpose: { type: 'string', description: 'What changed and why, in one sentence' },
        },
        required: ['file', 'content', 'purpose'],
      },
      execute: async ({ file, content, purpose }) => {
        if (!MEMBER_FILE_NAMES.includes(file as MemberFileName)) throw new Error(`Only ${MEMBER_FILE_NAMES.join(' and ')} can be proposed`)
        const proposal = host.propose('member-file', purpose, { file: { name: file, content } })
        return { proposalId: proposal.id, status: 'waiting for your owner' }
      },
    }),
  ]
}

function slice(text: string, offset?: number, limit?: number): string {
  const lines = text.split('\n')
  const start = Math.max(1, offset ?? 1)
  const end = limit === undefined ? lines.length : Math.min(lines.length, start - 1 + limit)
  const body = lines.slice(start - 1, end).join('\n')
  return body.length > MAX_READ_CHARS ? `${body.slice(0, MAX_READ_CHARS)}\n[truncated: read a line range]` : body
}

export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += pattern[index + 2] === '/' ? '(?:.*/)?' : '.*'
        index += pattern[index + 2] === '/' ? 2 : 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^$()|[\]{}\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}
