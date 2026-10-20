import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PageContent, PageView } from '@mr-robot/protocol'
import { keys, pageAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { pagePdfUrl, rawFileUrl } from '../client/mr-robot-api.ts'
import { href } from '../route.ts'
import { AtomView } from './AtomView.tsx'
import { InlineEdit } from './InlineEdit.tsx'
import { Markdown } from './Markdown.tsx'

/**
 * A Page's reading view (v1.17 ticket 05): a Markdown Page as a document with a table of contents (dp-nnzg), an HTML Page in a sandboxed frame
 * without the app's origin, with a Source view (dp-hv7b); Rename (dp-e0rp) and the PDF (dp-239c). \`share\` is the Share control (ticket 06).
 */
export function PageReader({ robotId, path, canEdit, share }: { robotId: string; path: string; canEdit: boolean; share?: (page: PageView) => ReactNode }) {
  const command = useCommand()
  return (
    <AtomView atom={pageAtom(robotId + '\n' + path)} what="the Page" errorTitle="This Page cannot be opened">
      {(content) => (
        <PageReading robotId={robotId} content={content} canEdit={canEdit} {...(share === undefined ? {} : { share })}
          onRename={async (title) => {
            const exit = await command((api) => api.renamePage(robotId, path, title), [keys.files(robotId), keys.robot(robotId)])
            return { failure: exitFailure(exit) }
          }} />
      )}
    </AtomView>
  )
}

export function PageReading({ robotId, content, canEdit, onRename, share }: { robotId: string; content: PageContent; canEdit: boolean; onRename: (title: string) => Promise<{ readonly failure: string | undefined }>; share?: (page: PageView) => ReactNode }) {
  const page = content.page
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string>()
  return (
    <article className="page-reader" data-format={page.format}>
      <header className="page-reader-head">
        <InlineEdit editing={renaming} value={page.title} label="Page title" onSave={async (title) => { const { failure } = await onRename(title); setError(failure); return failure === undefined }} onClose={() => setRenaming(false)}>
          <h1 className="page-title">{page.title}</h1>
        </InlineEdit>
        <div className="page-actions">
          {canEdit ? <button type="button" className="button" onClick={() => setRenaming(true)}>Rename</button> : null}
          <a className="button" href={pagePdfUrl(robotId, page.path)} download>PDF</a>
          <a className="link" href={href({ page: 'files', id: robotId, path: page.path })}>{page.path}</a>
        </div>
        {error === undefined ? null : <div className="muted" role="alert">{error}</div>}
        {share === undefined ? null : share(page)}
      </header>
      {page.format === 'markdown' ? <MarkdownPage robotId={robotId} path={page.path} title={page.title} text={content.text} /> : <HtmlPage title={page.title} text={content.text} />}
    </article>
  )
}

// ---------------------------------------------------------------- Markdown

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/** The parts of a Markdown Page: Markdown, and Mermaid fences drawn as diagrams. */
type Part = { readonly kind: 'markdown'; readonly text: string } | { readonly kind: 'mermaid'; readonly source: string }

/** Split the Page at its mermaid fences; headings are read outside every fence; a first heading that repeats the title is left to the header (pure). */
export function pageParts(markdown: string, title?: string): { readonly parts: Part[]; readonly headings: Array<{ readonly level: number; readonly text: string }> } {
  const parts: Part[] = []
  const headings: Array<{ level: number; text: string }> = []
  let prose: string[] = []
  let fence: { readonly marker: string; readonly mermaid: boolean; readonly lines: string[] } | undefined
  const flush = () => { if (prose.join('\n').trim() !== '') parts.push({ kind: 'markdown', text: prose.join('\n') }); prose = [] }
  for (const line of markdown.replace(FRONT_MATTER, '').split('\n')) {
    const opened = /^\s{0,3}(```+|~~~+)\s*([\w-]*)/.exec(line)
    if (fence !== undefined) {
      if (opened !== null && opened[1]!.startsWith(fence.marker) && opened[2] === '') {
        if (fence.mermaid) parts.push({ kind: 'mermaid', source: fence.lines.join('\n') })
        else prose.push(...fence.lines, line)
        fence = undefined
      } else fence.lines.push(line)
      continue
    }
    if (opened !== null) {
      const mermaid = opened[2]!.toLowerCase() === 'mermaid'
      if (mermaid) flush()
      fence = { marker: opened[1]!, mermaid, lines: mermaid ? [] : [line] }
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading !== null && heading[1] === '#' && headings.length === 0 && heading[2]!.trim() === title?.trim()) continue
    if (heading !== null) headings.push({ level: heading[1]!.length, text: heading[2]!.replace(/[*_`]/g, '') })
    prose.push(line)
  }
  if (fence !== undefined) prose.push(...(fence.mermaid ? ['```mermaid'] : []), ...fence.lines)
  flush()
  return { parts, headings }
}

/** The Workspace path an image of a Page names: relative to the Page, or from the Workspace root with a leading slash. */
export function pageImagePath(pagePath: string, destination: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('//') || destination.startsWith('#')) return undefined
  const parts: string[] = destination.startsWith('/') ? [] : pagePath.split('/').slice(0, -1)
  for (const part of decodeURIComponent(destination.split(/[?#]/)[0]!).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (parts.length === 0) return undefined; parts.pop(); continue }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

function MarkdownPage({ robotId, path, title, text }: { robotId: string; path: string; title: string; text: string }) {
  const { parts, headings } = useMemo(() => pageParts(text, title), [text, title])
  const body = useRef<HTMLDivElement>(null)
  const images = useMemo<MarkdownPathImages>(() => ({
    resolve: (value) => { const found = pageImagePath(path, value); return found === undefined ? undefined : new URL(rawFileUrl(robotId, found), location.origin).href },
  }), [robotId, path])
  // The contents list the sections under the title.
  const listed = headings.map((heading, index) => ({ ...heading, index })).filter((heading) => heading.level >= 2 && heading.level <= 3)
  const jump = (index: number) => body.current?.querySelectorAll('h1, h2, h3, h4, h5, h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="page-layout">
      {listed.length < 2 ? null : (
        <nav className="page-toc" aria-label="Contents">
          <div className="muted">Contents</div>
          <ol>{listed.map((heading) => <li key={heading.index} data-level={heading.level}><button type="button" className="link" onClick={() => jump(heading.index)}>{heading.text}</button></li>)}</ol>
        </nav>
      )}
      <div className="page-body" ref={body}>
        {parts.map((part, index) => part.kind === 'markdown' ? <Markdown key={index} text={part.text} pathImages={images} /> : <MermaidDiagram key={index} source={part.source} />)}
      </div>
    </div>
  )
}

let diagrams = 0

/** A Mermaid diagram, drawn by Mermaid loaded only when a Page has one; the source shows when it cannot be drawn. */
function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
      diagrams += 1
      const drawn = await mermaid.render('page-diagram-' + diagrams, source)
      if (live) setSvg(drawn.svg)
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [source])
  if (svg === undefined) return <pre className="page-diagram-source" data-failed={failed}>{source}</pre>
  // Mermaid's strict level sanitizes the SVG it draws (no scripts, no handlers).
  return <div className="page-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

// ---------------------------------------------------------------- HTML

/** What a Robot's HTML Page may do inside the frame: its own inline script and styles, inline images; nothing from anywhere. */
export const HTML_FRAME_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:"

/** The Page's HTML with the frame's policy first and links opening in a new tab. */
export function framedHtml(text: string): string {
  const head = '<meta http-equiv="Content-Security-Policy" content="' + HTML_FRAME_CSP + '"><base target="_blank">'
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (open) => open + head)
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (open) => open + '<head>' + head + '</head>')
  return '<!doctype html><html><head><meta charset="utf-8">' + head + '</head><body>' + text + '</body></html>'
}

/**
 * An HTML Page (dp-hv7b) in a frame without the app's origin: sandbox gives it scripts and new-tab links but no same-origin, so it reaches neither
 * the app's cookies nor its API; the policy in its head lets it load nothing.
 */
function HtmlPage({ title, text }: { title: string; text: string }) {
  const [source, setSource] = useState(false)
  return (
    <div className="page-html">
      <div className="page-actions"><button type="button" className="button" aria-pressed={source} onClick={() => setSource(!source)}>{source ? 'Page' : 'Source'}</button></div>
      {source
        ? <pre className="page-source">{text}</pre>
        : <iframe className="page-frame" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={framedHtml(text)} />}
    </div>
  )
}
