/**
 * The Code view (v1.21 ticket 07, cw-sc3z, cw-xxqw): one renderer set for a call, in the Conversation at Code (with the page's calls read
 * in full from the log) and in the Trajectory's inspector. Each renderer: a diff for edit and write, the fragment for read, the command and
 * its output with the exit code for run and job_output, lists for glob and grep, locations and hover for lsp, a summary for copy.
 */
import { RegistryProvider } from '@effect/atom-react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ToolCallDetail, ToolCallView } from '@mr-robot/protocol'
import events from './fixtures/session-events.json'
import { ChatView } from '../src/components/ChatView.tsx'
import { RobotTrajectory } from '../src/dsh/RobotTrajectory.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

interface Case {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly result: string
  /** What the rendered call shows. */
  readonly shows: readonly string[]
}

const CASES: readonly Case[] = [
  { name: 'edit', args: { on: 'workspace', file_path: 'src/a.ts', old_string: 'let a = 1', new_string: 'let a = 2' }, result: '{"on":"workspace","edited":"/repo/src/a.ts"}', shows: ['workspace: src/a.ts', '- let a = 1', '+ let a = 2'] },
  { name: 'write', args: { on: 'workspace', file_path: 'notes.md', content: 'first\nsecond' }, result: '{"written":"/repo/notes.md","bytes":12}', shows: ['notes.md (whole file)', '+ first', '+ second'] },
  { name: 'read', args: { on: 'workspace', file_path: 'src/b.ts' }, result: '<path>/repo/src/b.ts</path>\n<type>file</type>\n<size>20 bytes</size>\n<line-ending>crlf</line-ending>\n<hash>sha256:00</hash>\n<content>\n1: export {}\n\n(End of file - total 1 lines)\n</content>', shows: ['/repo/src/b.ts · crlf · 20 bytes', '1: export {}'] },
  { name: 'run', args: { on: 'workspace', command: 'pnpm test' }, result: '{"kind":"foreground","exitCode":1,"stdout":"2 passed","stderr":"1 failed"}', shows: ['$ pnpm test', 'exit 1', '2 passed', '1 failed'] },
  { name: 'job_output', args: { job_id: 'j-3' }, result: '{"jobId":"j-3","status":"completed","exitCode":0,"stdout":"built","stderr":""}', shows: ['$ job_output j-3', 'exit 0', 'built'] },
  { name: 'glob', args: { on: 'workspace', pattern: 'src/**/*.ts' }, result: '{"paths":["src/a.ts","src/b.ts"],"truncated":false}', shows: ['src/**/*.ts · 2', 'src/a.ts', 'src/b.ts'] },
  { name: 'grep', args: { on: 'workspace', pattern: 'greet' }, result: '{"matches":[{"path":"src/a.ts","line":3,"text":"greet(name)"}],"truncated":true}', shows: ['/greet/ · 1+', 'src/a.ts:3: greet(name)', 'The list was cut'] },
  { name: 'lsp', args: { on: 'workspace', operation: 'findReferences', file_path: 'src/a.ts', line: 1, character: 17 }, result: '{"kind":"locations","locations":[{"path":"src/a.ts","line":1,"character":17,"endLine":1,"endCharacter":22},{"path":"src/b.ts","line":3,"character":1,"endLine":3,"endCharacter":6}]}', shows: ['findReferences src/a.ts:1:17', 'src/a.ts:1:17', 'src/b.ts:3:1'] },
  { name: 'copy', args: { from: { on: 'files', path: 'big.zip' }, to: { on: 'Desk', path: '/tmp/big.zip' } }, result: '{"bytes":2100000000,"took":"2.1 GB in 41 s"}', shows: ['files: big.zip → Desk: /tmp/big.zip', '2.1 GB in 41 s'] },
]

const view = (entry: Case, clipped = false): ToolCallView => ({ id: `call-${entry.name}`, name: entry.name, args: clipped ? '{"cut": true' : JSON.stringify(entry.args, null, 2), result: clipped ? 'cut…' : entry.result, error: false, inner: [] })

describe('the Conversation at Code (cw-sc3z)', () => {
  it('renders each call with its renderer, open, from the full call the log gave when the row holds a clipped copy', () => {
    const items: ChatItem[] = CASES.map((entry, index) => ({ kind: 'activity', id: `a-${index}`, seq: index, at: 1, tools: [entry.name], calls: [view(entry, true)] }))
    const details = new Map<string, ToolCallDetail>(CASES.map((entry, index) => [`call-${entry.name}`, { itemId: `a-${index}`, ...view(entry) }]))
    render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} workDetails="code" callDetails={details} />)
    const text = document.body.textContent ?? ''
    for (const entry of CASES) for (const shown of entry.shows) expect(text, `${entry.name}: ${shown}`).toContain(shown)
    expect(screen.getAllByLabelText(/^Diff of /)).toHaveLength(2)
  })

  it('falls back to the plain card for another tool, and shows the clipped copy until the full call came', () => {
    const items: ChatItem[] = [
      { kind: 'activity', id: 'a-1', seq: 1, at: 1, tools: ['web_fetch'], calls: [{ id: 'c-1', name: 'web_fetch', args: '{"url":"https://example.com"}', result: 'page text', error: false, inner: [] }] },
      { kind: 'activity', id: 'a-2', seq: 2, at: 1, tools: ['edit'], calls: [view(CASES[0]!)] },
    ]
    render(<ChatView items={items} meId="m-1" working={false} canAnswer={false} workDetails="code" />)
    expect(document.body.textContent).toContain('page text')
    expect(screen.getByLabelText('Diff of workspace: src/a.ts').textContent).toContain('+ let a = 2')
  })
})

describe('the Trajectory inspector (cw-sc3z, cw-xxqw)', () => {
  /** The fixture's one tool call made into `entry`. */
  const withCall = (entry: Case) => (events as Array<{ type: string; data: Record<string, unknown> }>).map((event) => {
    if (event.type === 'tool/call') return { ...event, data: { ...event.data, name: entry.name, arguments: JSON.stringify(entry.args) } }
    if (event.type === 'assistant/message' && JSON.stringify(event).includes('"tool-call"')) {
      const message = event.data['message'] as { content: Array<Record<string, unknown>> }
      return { ...event, data: { ...event.data, message: { ...message, content: message.content.map((block) => (block['type'] === 'tool-call' ? { ...block, name: entry.name, arguments: JSON.stringify(entry.args) } : block)) } } }
    }
    if (event.type === 'tool/result') {
      const message = event.data['message'] as Record<string, unknown>
      return { ...event, data: { ...event.data, message: { ...message, content: [{ type: 'text', text: entry.result }] } } }
    }
    return event
  }).filter((event) => !event.type.startsWith('tool/ptc-dispatch'))

  for (const entry of CASES) {
    it(`renders ${entry.name} as the Conversation does`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: string) => (String(input).endsWith('/subagents') ? Response.json([]) : Response.json({ sessionId: 's-1', hasMore: false, events: withCall(entry) }))))
      render(<RegistryProvider><RobotTrajectory robotId={`r-code-${entry.name}`} liveVersion={0} /></RegistryProvider>)
      await vi.waitFor(() => expect(document.querySelectorAll('tr[data-kind]').length).toBeGreaterThan(3))
      fireEvent.click(document.querySelector('tr[data-kind="tool"]')!)
      await vi.waitFor(() => expect(document.querySelector('.code-call')).not.toBeNull())
      const shown = document.querySelector('.code-call')!.textContent ?? ''
      for (const part of entry.shows) expect(shown, `${entry.name}: ${part}`).toContain(part)
      expect(within(document.body).queryAllByText(/./).length).toBeGreaterThan(0)
    })
  }
})
