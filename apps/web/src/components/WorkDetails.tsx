import { useState, type ReactNode } from 'react'
import type { ToolCallView, WorkDetails } from '@mr-robot/protocol'
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
  if (/^(read|glob|grep|ls|host_read)$/.test(name)) return <IconFolderOpenOutlineRegular />
  if (/^(write|edit|host_write|skill_write|memory_write_shared)$/.test(name)) return <IconEditOutlineRegular />
  if (/search/.test(name)) return <IconSearchOutlineRegular />
  if (/^(web_fetch|crawling_exa)$/.test(name) || name.startsWith('browser_')) return <IconGlobeOutlineRegular />
  if (/schedule|routine/.test(name)) return <IconAlarmClockOutlineRegular />
  if (/message|reply|notify/.test(name)) return <IconSendOutlineRegular />
  if (/login/.test(name)) return <IconLinkOutlineRegular />
  return <IconSparkleRegular />
}

/** A tool call's one-line title, as the DSH cards phrase it: the tool and its main argument. */
function title(call: ToolCallView): string {
  let args: Record<string, unknown> = {}
  try { args = JSON.parse(call.args) as Record<string, unknown> } catch { /* truncated */ }
  const main = args['file_path'] ?? args['path'] ?? args['url'] ?? args['pattern'] ?? args['query'] ?? args['command'] ?? args['queries'] ?? args['name'] ?? args['to']
  const label = call.name === 'run_code' ? 'Code program' : call.name.replace(/_/g, ' ')
  const detail = main === undefined ? '' : ` ${Array.isArray(main) ? main.join(', ') : String(main)}`
  return `${label}${detail.length > 80 ? detail.slice(0, 80) + '…' : detail}${call.error ? ' (failed)' : ''}`
}

function ToolCard({ call, initiallyOpen }: { call: ToolCallView; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <DisclosureRow className="tool-card" icon={toolIcon(call.name)} title={title(call)} open={open} expandable expandOnRowClick previewChevron onToggle={() => setOpen(!open)}>
      <div className="tool-card-body">
        {call.inner.length > 0 ? (
          <ul className="tool-card-inner">{call.inner.map((inner, index) => <li key={index}><code>{inner.name}</code> <span className="muted">{inner.args}</span></li>)}</ul>
        ) : null}
        <div className="tool-card-label">Input</div>
        <pre>{call.args}</pre>
        <div className="tool-card-label">{call.error ? 'Error' : 'Result'}</div>
        <pre className={call.error ? 'tool-card-error' : undefined}>{call.result || '(empty)'}</pre>
      </div>
    </DisclosureRow>
  )
}

/** One step's tool calls as DSH tool cards (Standard: collapsed; Verbose: open) (pl-etps). */
export function ToolCards({ calls, level }: { calls: readonly ToolCallView[]; level: WorkDetails }) {
  return <div className="tool-cards">{calls.map((call) => <ToolCard key={call.id} call={call} initiallyOpen={level === 'verbose'} />)}</div>
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
]
