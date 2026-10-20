/**
 * Markdown as HTML on the server (v1.17): e-mail bodies (dp-ky1h) and Pages for PDF and sharing (dp-239c). The grammar is the one the app reads
 * Markdown with (micromark with GFM: tables, task lists, strikethrough, autolinks); raw HTML in the source is escaped, never passed through,
 * and link and image addresses are sanitized by micromark.
 */
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { math, mathHtml } from 'micromark-extension-math'

/** The body of an HTML document for this Markdown; `math` also renders TeX ($…$, $$…$$) with KaTeX, as the app does. */
export function markdownToHtml(markdown: string, options: { readonly math?: boolean } = {}): string {
  return options.math === true
    ? micromark(markdown, { extensions: [gfm(), math()], htmlExtensions: [gfmHtml(), mathHtml({ throwOnError: false })] })
    : micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
}

const EMAIL_STYLE = 'font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1f2328;'

/** An e-mail's HTML part: the Markdown rendered, in a plain document readable by every mail client; `quoted` follows it as preformatted text. */
export function emailHtml(markdown: string, quoted?: string): string {
  const tail = quoted === undefined ? '' : `<pre style="white-space: pre-wrap; font-family: inherit">${escapeHtml(quoted)}</pre>`
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="${EMAIL_STYLE}">${markdownToHtml(markdown)}${tail}</body></html>`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
