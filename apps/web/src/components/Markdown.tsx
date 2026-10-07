import { memo, type MouseEvent } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

const LABELS: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

/** Links leave the app: a new tab in the browser, the system browser in the desktop app. */
function openOutside(event: MouseEvent<HTMLDivElement>): void {
  const anchor = (event.target as HTMLElement).closest('a')
  if (anchor === null || anchor.getAttribute('href')?.startsWith('#') === true) return
  event.preventDefault()
  window.open(anchor.href, '_blank', 'noopener,noreferrer')
}

/** A Robot's message as Markdown (pl-6bop), rendered by the DSH conversation's Markdown component. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="markdown" onClick={openOutside}>
      <MarkdownText text={text} labels={LABELS} streaming={streaming} />
    </div>
  )
})
