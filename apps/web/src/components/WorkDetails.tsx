import { useState, type ReactNode } from 'react'
import type { ToolCallDetail, ToolCallView, WorkDetails } from '@mr-robot/protocol'
import { codeCall } from './CodeRenderers.tsx'
import {
  DisclosureRow,
  IconAlarmClockOutlineRegular,
  IconCodeOutlineRegular,
  IconEditOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconGlobeOutlineRegular,
  IconLinkOutlineRegular,
  IconSearchOutlineRegular,
  IconSendOutlineRegular,
  IconSparkleRegular,
  IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** The DSH conversation's icon for a tool, by what it does. */
function toolIcon(name: string): ReactNode {
  if (name === 'run_code') return <IconCodeOutlineRegular />
  if (/^(read|glob|grep|ls|copy|delete_file|host_read)$/.test(name)) return <IconFolderOpenOutlineRegular />
  if (/^(write|edit|host_write|skill_write|memory_write_shared)$/.test(name)) return <IconEditOutlineRegular />
  if (/search/.test(name)) return <IconSearchOutlineRegular />
  if (/^(web_fetch|crawling_exa)$/.test(name) || name.startsWith('browser_')) return <IconGlobeOutlineRegular />
  if (/schedule|task_/.test(name)) return <IconAlarmClockOutlineRegular />
  if (/message|reply|notify/.test(name)) return <IconSendOutlineRegular />
  if (/login/.test(name)) return <IconLinkOutlineRegular />
  return <IconSparkleRegular />
}

/** The place a call names (v1.16 \`on\`: workspace, box or a Host), in front of its main argument. Calls recorded before it have none. */
function placed(args: Record<string, unknown>, main: unknown): unknown {
  return typeof args['on'] === 'string' && main !== undefined && !Array.isArray(main) ? `${args['on']}: ${String(main)}` : main
}

function copyLine(args: Record<string, unknown>): string | undefined {
  const end = (value: unknown): string | undefined => {
    const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    return typeof record['on'] === 'string' && typeof record['path'] === 'string' ? `${record['on']}: ${record['path']}` : undefined
  }
  const [from, to] = [end(args['from']), end(args['to'])]
  return from === undefined || to === undefined ? undefined : `${from} → ${to}`
}

/** What a copy moved and how long it took ("2.1 GB in 41 s"), from its result, for the card's title; nothing when the result has none. */
function copyTook(result: string): string {
  try {
    const took = (JSON.parse(result) as Record<string, unknown>)['took']
    return typeof took === 'string' ? ` · ${took}` : ''
  } catch {
    return ''
  }
}

/** A tool call's one-line title, as the DSH cards phrase it: the tool and its main argument. */
function title(call: ToolCallView): string {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(call.args) as Record<string, unknown> } catch { /* truncated */ }
  const main = call.name === 'copy' ? copyLine(args) : placed(args, args['file_path'] ?? args['path'] ?? args['url'] ?? args['pattern'] ?? args['query'] ?? args['command'] ?? args['queries'] ?? args['name'] ?? args['to'])
  const label = call.name === 'run_code' ? 'Code program' : call.name.replace(/_/g, ' ')
  const detail = main === undefined ? '' : ` ${Array.isArray(main) ? main.join(', ') : String(main)}`
  return `${label}${detail.length > 80 ? detail.slice(0, 80) + '…' : detail}${call.name === 'copy' && !call.error ? copyTook(call.result) : ''}${call.error ? ' (failed)' : ''}`
}

function ToolCard({ call, initiallyOpen, detail, code }: { call: ToolCallView; initiallyOpen: boolean; detail?: ToolCallDetail | undefined; code: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  // At Code (cw-sc3z) the call reads as code: the full call from the log when it came, else the clipped one, through the shared renderers.
  const rendered = code ? codeCall(detail ?? call) : null
  return (
    <DisclosureRow className="tool-card" icon={toolIcon(call.name)} title={title(call)} open={open} expandable expandOnRowClick previewChevron onToggle={() => setOpen(!open)}>
      {rendered !== null ? <div className="tool-card-body">{rendered}</div> : <div className="tool-card-body">
        {call.inner.length > 0 ? (
          <ul className="tool-card-inner">{call.inner.map((inner, index) => <li key={index}><code>{inner.name}</code> <span className="muted">{inner.args}</span></li>)}</ul>
        ) : null}
        <div className="tool-card-label">Input</div>
        <pre>{call.args}</pre>
        <div className="tool-card-label">{call.error ? 'Error' : 'Result'}</div>
        <pre className={call.error ? 'tool-card-error' : undefined}>{(code ? detail?.result : undefined) ?? (call.result || '(empty)')}</pre>
      </div>}
    </DisclosureRow>
  )
}

/** One step's tool calls as DSH tool cards (Standard: collapsed; Verbose and Code: open) (pl-etps, cw-sc3z). */
export function ToolCards({ calls, level, details }: { calls: readonly ToolCallView[]; level: WorkDetails; details?: ReadonlyMap<string, ToolCallDetail> | undefined }) {
  return <div className="tool-cards">{calls.map((call) => <ToolCard key={call.id} call={call} initiallyOpen={level === 'verbose' || level === 'code'} code={level === 'code'} detail={details?.get(call.id)} />)}</div>
}

/** The model's thinking, as the DSH conversation's Think row: collapsed at Detailed, open at Verbose. */
export function ThinkingRow({ text, level, running = false }: { text: string; level: WorkDetails; running?: boolean }) {
  const [open, setOpen] = useState(level === 'verbose')
  return (
    <DisclosureRow className="tool-card thinking-row" icon={<IconThinkOutlineRegular />} title={running ? 'Thinking…' : 'Thought'} open={open} expandable expandOnRowClick previewChevron running={running} onToggle={() => setOpen(!open)}>
      <div className="tool-card-body thinking-text">{text}</div>
    </DisclosureRow>
  )
}

export const WORK_DETAILS: ReadonlyArray<{ id: WorkDetails; label: string; note: string }> = [
  { id: 'compact', label: 'Compact', note: 'One line of what the Robot is doing; no tool cards.' },
  { id: 'standard', label: 'Standard', note: 'Each tool the Robot used as a collapsed card.' },
  { id: 'detailed', label: 'Detailed', note: 'Tool cards and the model\'s thinking, as in DeepSeek Harness.' },
  { id: 'verbose', label: 'Verbose', note: 'Everything open: inputs, results and thinking.' },
  { id: 'code', label: 'Code', note: 'Every call in full as code: diffs, file fragments, commands with their output, search lists and locations.' },
]
