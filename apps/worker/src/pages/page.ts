/**
 * Pages (v1.17 ticket 05, dp-53pf): a Page is a file under pages/ in the Workspace, Markdown (.md) or HTML (.html), with a title. The file is the
 * state: the reading view, the PDF and a share link are views over it. This module is pure: which paths are Pages, their title and first lines,
 * and the file with a new title.
 */

export type PageFormat = 'markdown' | 'html'

export const PAGES_DIRECTORY = 'pages'

/** The Robot's kv key of the Page titles the Conversation shows on Page cards (path → title), as the Pages were last read. */
export const PAGE_TITLES = 'page-titles'

/** The format of a Page at this Workspace path; undefined for a path that is not a Page. */
export function pageFormat(path: string): PageFormat | undefined {
  if (!path.startsWith(PAGES_DIRECTORY + '/')) return undefined
  const lower = path.toLowerCase()
  return lower.endsWith('.md') ? 'markdown' : lower.endsWith('.html') || lower.endsWith('.htm') ? 'html' : undefined
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const TITLE_LINE = /^title:[ \t]*(.*)$/m
const HTML_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const HTML_H1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

/** A YAML scalar as a title: quotes removed. */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'")
  return trimmed
}

/** The lines of Markdown outside fenced code blocks, with their index. */
function proseLines(markdown: string): Array<{ readonly index: number; readonly line: string }> {
  const out: Array<{ index: number; line: string }> = []
  let fence: string | undefined
  markdown.split('\n').forEach((line, index) => {
    const opened = /^\s{0,3}(```+|~~~+)/.exec(line)
    if (fence !== undefined) {
      if (opened !== null && opened[1]!.startsWith(fence)) fence = undefined
      return
    }
    if (opened !== null) { fence = opened[1]!; return }
    out.push({ index, line })
  })
  return out
}

/** The Markdown without its front matter. */
export function markdownBody(markdown: string): string {
  return markdown.replace(FRONT_MATTER, '')
}

/** The file name without directory and extension: the title of a Page that names none. */
function fileTitle(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(md|html?)$/i, '')
}

/** A Page's title: front matter title, else the first H1 (Markdown); <title>, else the first <h1> (HTML); else the file name. */
export function pageTitle(path: string, text: string): string {
  const format = pageFormat(path)
  if (format === 'markdown') {
    const front = FRONT_MATTER.exec(text)?.[1]
    const named = front === undefined ? undefined : TITLE_LINE.exec(front)?.[1]
    if (named !== undefined && unquote(named) !== '') return unquote(named)
    const heading = proseLines(markdownBody(text)).find(({ line }) => /^#\s+\S/.test(line))
    if (heading !== undefined) return heading.line.replace(/^#\s+/, '').replace(/\s+#+\s*$/, '').trim()
  }
  if (format === 'html') {
    const title = HTML_TITLE.exec(text)?.[1] ?? HTML_H1.exec(text)?.[1]
    if (title !== undefined && stripTags(title) !== '') return stripTags(title)
  }
  return fileTitle(path)
}

const EXCERPT_CHARS = 240

/** The first lines a Page card shows: its text after the title, without markup. */
export function pageExcerpt(path: string, text: string): string {
  if (pageFormat(path) === 'html') {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(text)?.[1] ?? text
    return clip(stripTags(body.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ').replace(HTML_H1, ' ')))
  }
  const lines = proseLines(markdownBody(text)).map(({ line }) => line.trim()).filter((line) => line !== '' && !/^#\s/.test(line) && !/^\|?[\s:-]+\|[\s|:-]*$/.test(line))
  return clip(lines.map((line) => line.replace(/^#{2,6}\s+/, '').replace(/^[-*+]\s+|^\d+\.\s+|^>\s?/, '').replace(/[*_`~]/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')).join(' '))
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_CHARS ? flat : flat.slice(0, EXCERPT_CHARS - 1).trimEnd() + '…'
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A title as a YAML scalar: quoted when it holds what YAML would read otherwise. */
function yamlTitle(title: string): string {
  return /^[^:#'"\[\]{}&*!|>%@`,?-][^:#]*$/.test(title) && title.trim() === title ? title : '"' + title.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** The file with a new title, in place (dp-e0rp): front matter title, else the first H1, else a new front matter; <title>, else a new one in <head>. */
export function renamedPage(path: string, text: string, title: string): string {
  const clean = title.replace(/[\r\n]+/g, ' ').trim()
  if (pageFormat(path) === 'html') {
    if (HTML_TITLE.test(text)) return text.replace(HTML_TITLE, (match) => match.replace(/>[\s\S]*?</, '>' + escapeHtml(clean) + '<'))
    if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (head) => head + '<title>' + escapeHtml(clean) + '</title>')
    return '<title>' + escapeHtml(clean) + '</title>\n' + text
  }
  const front = FRONT_MATTER.exec(text)
  if (front !== null) {
    const inner = front[1]!
    const next = TITLE_LINE.test(inner) ? inner.replace(TITLE_LINE, 'title: ' + yamlTitle(clean)) : 'title: ' + yamlTitle(clean) + '\n' + inner
    return text.replace(FRONT_MATTER, (whole) => whole.replace(inner, () => next))
  }
  const lines = text.split('\n')
  const heading = proseLines(text).find(({ line }) => /^#\s+\S/.test(line))
  if (heading !== undefined) {
    lines[heading.index] = '# ' + clean
    return lines.join('\n')
  }
  return '---\ntitle: ' + yamlTitle(clean) + '\n---\n\n' + text
}
