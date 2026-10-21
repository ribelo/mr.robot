/**
 * How a tool call reads at the Code level (v1.21 ticket 07, cw-sc3z, cw-xxqw): one renderer set, used by the Conversation's Code view and
 * by the Trajectory's inspector, so that a call reads the same in both. A diff for edit and write, the fragment for read, the command and
 * its output with the exit code for run and the job tools, lists for glob and grep, locations for lsp, a summary for copy. A call of
 * another tool, or one whose input or result cannot be read (a cut result, an old shape), has no renderer here: the caller shows it as
 * before.
 */
import type { ReactNode } from 'react'
import { diffLines } from 'diff'

/** One call as a renderer reads it: the arguments as their JSON text and the result as the tool's text. */
export interface CodeCall {
  readonly name: string
  readonly args: string
  readonly result: string
  readonly error: boolean
}

type Json = Record<string, unknown>
const parse = (text: string): Json | undefined => {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const where = (args: Json): string => (typeof args['on'] === 'string' ? `${args['on']}: ` : '')

/** A unified diff of two texts, line by line: removed lines with -, added with +, the rest as context. */
export function DiffBlock({ before, after, label }: { before: string; after: string; label: string }) {
  const parts = diffLines(before, after)
  return (
    <div className="code-call code-diff">
      <div className="code-call-head">{label}</div>
      <pre aria-label={`Diff of ${label}`}>
        {parts.flatMap((part, index) => part.value.replace(/\n$/, '').split('\n').map((line, at) => {
          const kind = part.added === true ? 'added' : part.removed === true ? 'removed' : 'context'
          return <div key={`${index}-${at}`} className={`diff-line diff-${kind}`}>{kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '} {line}</div>
        }))}
      </pre>
    </div>
  )
}

/** The window read returned: its path and numbered lines, without the tags around them. */
function Fragment({ args, result }: { args: Json; result: string }) {
  const path = /<path>([\s\S]*?)<\/path>/.exec(result)?.[1] ?? text(args['file_path']) ?? ''
  const body = /<content>\n?([\s\S]*?)\n?<\/content>/.exec(result)?.[1] ?? result
  const facts = [/<line-ending>(.*?)<\/line-ending>/.exec(result)?.[1], /<size>(.*?)<\/size>/.exec(result)?.[1]].filter((fact) => fact !== undefined)
  return (
    <div className="code-call code-fragment">
      <div className="code-call-head">{where(args)}{path}{facts.length === 0 ? '' : ` · ${facts.join(' · ')}`}</div>
      <pre aria-label={`Lines of ${path}`}>{body}</pre>
    </div>
  )
}

/** A command and what it printed, with its exit code or the job it became. */
function Command({ command, cwd, result, place }: { command: string; cwd: string | undefined; result: Json; place: string }) {
  const out = typeof result['stdout'] === 'string' ? result['stdout'] : text((result['stdout'] as Json | undefined)?.['text']) ?? ''
  const err = typeof result['stderr'] === 'string' ? result['stderr'] : text((result['stderr'] as Json | undefined)?.['text']) ?? ''
  const exit = typeof result['exitCode'] === 'number' ? `exit ${result['exitCode']}` : typeof result['jobId'] === 'string' ? `job ${result['jobId']}${typeof result['status'] === 'string' ? ` · ${result['status']}` : ''}` : ''
  return (
    <div className="code-call code-command">
      <div className="code-call-head">{place}{cwd === undefined ? '' : `${cwd} `}<code>$ {command}</code>{exit === '' ? null : <span className={result['exitCode'] === 0 ? 'code-exit ok' : 'code-exit'}>{exit}</span>}</div>
      {out === '' ? null : <pre aria-label="Output">{out}</pre>}
      {err === '' ? null : <pre aria-label="Errors" className="code-stderr">{err}</pre>}
      {typeof result['note'] === 'string' ? <div className="muted">{result['note']}</div> : null}
    </div>
  )
}

function List({ head, lines, truncated }: { head: string; lines: readonly string[]; truncated: boolean }) {
  return (
    <div className="code-call code-list">
      <div className="code-call-head">{head} · {lines.length}{truncated ? '+' : ''}</div>
      <ul>{lines.map((line, index) => <li key={index}><code>{line}</code></li>)}</ul>
      {truncated ? <div className="muted">The list was cut; there are more.</div> : null}
    </div>
  )
}

/** lsp's answer (cw-xxqw): the locations as path:line:character, or the hover text. */
export function Locations({ result, label }: { result: Json; label: string }) {
  if (result['kind'] === 'hover') {
    return (
      <div className="code-call code-locations">
        <div className="code-call-head">{label}</div>
        <pre>{typeof result['contents'] === 'string' ? result['contents'] : 'Nothing at this position.'}</pre>
      </div>
    )
  }
  const locations = Array.isArray(result['locations']) ? (result['locations'] as Json[]) : []
  return <List head={label} lines={locations.map((location) => `${String(location['path'])}:${String(location['line'])}:${String(location['character'])}`)} truncated={false} />
}

/** The renderer of a call, or null when the call has none (another tool, or a result that cannot be read). */
export function codeCall(call: CodeCall): ReactNode | null {
  const args = parse(call.args)
  if (args === undefined || call.error) return null
  const result = parse(call.result)
  const place = where(args)
  switch (call.name) {
    case 'edit': {
      const path = text(args['file_path'])
      const before = text(args['old_string'])
      const after = text(args['new_string'])
      return path === undefined || before === undefined || after === undefined ? null : <DiffBlock before={before} after={after} label={`${place}${path}${args['replace_all'] === true ? ' (every occurrence)' : ''}`} />
    }
    case 'write': {
      const path = text(args['file_path'])
      const content = text(args['content'])
      return path === undefined || content === undefined ? null : <DiffBlock before="" after={content} label={`${place}${path} (whole file)`} />
    }
    case 'read':
      return call.result.includes('<content>') ? <Fragment args={args} result={call.result} /> : null
    case 'run': {
      const command = text(args['command'])
      return command === undefined || result === undefined ? null : <Command command={command} cwd={text(args['cwd'])} result={result} place={place} />
    }
    case 'job_output':
      return result === undefined ? null : <Command command={`job_output ${String(args['job_id'] ?? '')}`} cwd={undefined} result={result} place="" />
    case 'glob':
      return result === undefined || !Array.isArray(result['paths']) ? null : <List head={`${place}${String(args['pattern'] ?? '')}`} lines={(result['paths'] as unknown[]).map(String)} truncated={result['truncated'] === true} />
    case 'grep':
      return result === undefined || !Array.isArray(result['matches']) ? null : <List head={`${place}/${String(args['pattern'] ?? '')}/`} lines={(result['matches'] as Json[]).map((match) => `${String(match['path'])}:${String(match['line'])}: ${String(match['text'])}`)} truncated={result['truncated'] === true} />
    case 'lsp':
      return result === undefined ? null : <Locations result={result} label={`${String(args['operation'] ?? 'lsp')} ${String(args['file_path'] ?? '')}:${String(args['line'] ?? '')}:${String(args['character'] ?? '')}`} />
    case 'copy': {
      if (result === undefined) return null
      const end = (value: unknown) => { const record = (value ?? {}) as Json; return `${String(record['on'] ?? '')}: ${String(record['path'] ?? '')}` }
      return (
        <div className="code-call code-copy">
          <div className="code-call-head">{end(args['from'])} → {end(args['to'])}</div>
          <div>{typeof result['took'] === 'string' ? result['took'] : `${String(result['bytes'] ?? '?')} bytes`}</div>
        </div>
      )
    }
    default:
      return null
  }
}
