/**
 * A Page as one HTML document (v1.17, dp-239c, dp-jl3d): what Browser Rendering prints to PDF and what a share link serves. A Markdown Page is
 * rendered on the server with the app's grammar (GFM, KaTeX), its Workspace images inlined, Mermaid diagrams drawn in the page; an HTML Page is
 * the Robot's file with a Content-Security-Policy that lets it load nothing from anywhere (dp-p5yn). KaTeX's styles and Mermaid come from the
 * app's own origin (/vendor/, packages/protocol/src/vendor.ts), never from a CDN (v1.17 review 3).
 */
import { KATEX_CSS_PATH, MERMAID_MODULE_PATH } from '@mr-robot/protocol'
import { escapeHtml, markdownToHtml } from '../platform/markdown-html.ts'
import { markdownBody, pageFormat } from './page.ts'

/** What a Robot's HTML Page may do: run its own inline script and styles, show inline images; reach nothing. */
export const HTML_PAGE_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:"

/**
 * The Content-Security-Policy of a rendered Markdown Page: its own inline styles and script, KaTeX and Mermaid from `source`, nothing else. A share
 * link sends it with 'self'; the document carries it with the app's origin, because Browser Rendering opens it with no address of its own.
 */
export const markdownPageCsp = (source: string): string => `default-src 'none'; img-src data:; style-src 'unsafe-inline' ${source}; font-src ${source} data:; script-src 'unsafe-inline' ${source}`

const STYLE = [
  'body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height: 1.55; color: #1f2328; max-width: 46rem; margin: 2.5rem auto; padding: 0 1.25rem; }',
  'h1 { font-size: 2rem; margin: 0 0 1.5rem; } h2 { margin-top: 2rem; } table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 4px 10px; }',
  'pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow-x: auto; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }',
  'img { max-width: 100%; } blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid #d0d7de; color: #57606a; }',
  '@media print { body { margin: 0 auto; } a { color: inherit; } }',
].join('\n')

/** Mermaid fences become diagrams; window.pageReady says the page is drawn (the PDF waits for it). */
const diagrams = (mermaid: string): string => '<script type="module">\n' +
  'const blocks = [...document.querySelectorAll("pre > code.language-mermaid")]\n' +
  'if (blocks.length === 0) { window.pageReady = true } else {\n' +
  '  for (const code of blocks) { const div = document.createElement("div"); div.className = "mermaid"; div.textContent = code.textContent; code.parentElement.replaceWith(div) }\n' +
  '  import("' + mermaid + '").then(async ({ default: mermaid }) => { mermaid.initialize({ startOnLoad: false, securityLevel: "strict" }); await mermaid.run() }).catch(() => undefined).finally(() => { window.pageReady = true })\n' +
  '}\n</script>'

/** A Workspace image as the page needs it: its bytes and type, or undefined when there is none. */
export type ReadImage = (path: string) => Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined>

const MAX_INLINE_IMAGE = 4 * 1024 * 1024

/** The Workspace path an image destination of a Page names: relative to the Page's directory, or from the Workspace root with a leading slash. */
export function imagePath(pagePath: string, destination: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('//') || destination.startsWith('#')) return undefined
  const clean = decodeURIComponent(destination.split(/[?#]/)[0]!)
  const base = clean.startsWith('/') ? [] : pagePath.split('/').slice(0, -1)
  const parts: string[] = [...base]
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') { if (parts.length === 0) return undefined; parts.pop(); continue }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

/** Workspace images of a rendered page inlined as data URLs, so the document needs nothing from the app. */
async function inlineImages(html: string, pagePath: string, read: ReadImage): Promise<string> {
  const sources = [...new Set([...html.matchAll(/<img src="([^"]*)"/g)].map((match) => match[1]!))]
  const resolved = new Map<string, string>()
  for (const source of sources) {
    const path = imagePath(pagePath, source.replace(/&amp;/g, '&'))
    const image = path === undefined ? undefined : await read(path).catch(() => undefined)
    if (image !== undefined && image.contentType.startsWith('image/') && image.contentType !== 'image/svg+xml' && image.bytes.byteLength <= MAX_INLINE_IMAGE) resolved.set(source, 'data:' + image.contentType + ';base64,' + base64(image.bytes))
  }
  return html.replace(/<img src="([^"]*)"/g, (match, source: string) => { const data = resolved.get(source); return data === undefined ? match : '<img src="' + data + '"' })
}

/** The Page as one HTML document: rendered Markdown with its title, or the Robot's HTML with the sandboxing policy in its head. `origin` is the app's. */
export async function pageDocument(path: string, title: string, text: string, read: ReadImage, origin: string): Promise<string> {
  if (pageFormat(path) === 'html') return withPolicy(text, HTML_PAGE_CSP)
  const body = await inlineImages(markdownToHtml(markdownBody(text), { math: true }), path, read)
  const heading = /^\s*<h1[\s>]/.test(body) ? '' : '<h1>' + escapeHtml(title) + '</h1>'
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + markdownPageCsp(origin) + '">' +
    '<title>' + escapeHtml(title) + '</title><link rel="stylesheet" href="' + origin + KATEX_CSS_PATH + '"><style>' + STYLE + '</style></head><body>' +
    heading + body + diagrams(origin + MERMAID_MODULE_PATH) + '</body></html>'
}

/** An HTML document with a Content-Security-Policy meta first in its head (a header is not there when Browser Rendering sets the content). */
function withPolicy(html: string, policy: string): string {
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">'
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => head + meta)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (open) => open + '<head>' + meta + '</head>')
  return '<!doctype html><html><head><meta charset="utf-8">' + meta + '</head><body>' + html + '</body></html>'
}
