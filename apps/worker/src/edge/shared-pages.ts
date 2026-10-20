/**
 * Shared Pages (v1.17 ticket 06, dp-jl3d, dp-p5yn): /p/<token> is outside the Access login (a bypass application in infra/stack.ts). The token's
 * signature is checked before any Durable Object is named; the Member that shares finds the share by the token's hash, and a revoked one is gone.
 * The answer is the Page's title, its content and its PDF, nothing of the app: no cookies are set, nothing is cached, and the Page runs in a
 * sandbox with an opaque origin, so its script can reach neither the app nor its API.
 *
 * - /p/<token>: a Markdown Page rendered on the server; an HTML Page in a frame under a header with its title and the PDF link.
 * - /p/<token>/content: an HTML Page itself, under a Content-Security-Policy sandbox.
 * - /p/<token>/pdf: the Page printed by Browser Rendering.
 */
import { escapeHtml } from '../platform/markdown-html.ts'
import { HTML_PAGE_CSP, MARKDOWN_PAGE_CSP } from '../pages/page-html.ts'
import { signedShareToken } from '../pages/share-token.ts'
import type { Env } from '../env.ts'
import { pdfResponse } from './api.ts'

const SHARED_PATH = new URLPattern({ pathname: '/p/:token/:part?' })

export const isSharedPagePath = (path: string): boolean => path.startsWith('/p/')

/** Sandbox without allow-same-origin: the document gets an opaque origin (CSP Level 3, sandbox directive). */
const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'

const COMMON: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' }

const notFound = (): Response => new Response('This page is not shared, or no longer.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...COMMON } })

const html = (body: string, policy: string): Response => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy, ...COMMON } })

/** The header above an HTML Page: its title and the PDF link; the Page itself is framed. */
function frameDocument(title: string, token: string): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escapeHtml(title) + '</title>' +
    '<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;height:100vh}header{display:flex;gap:16px;align-items:baseline;padding:10px 16px;border-bottom:1px solid #d0d7de}h1{font-size:1.1rem;margin:0}iframe{flex:1;border:0;width:100%}</style></head>' +
    '<body><header><h1>' + escapeHtml(title) + '</h1><a href="/p/' + token + '/pdf">PDF</a></header><iframe title="' + escapeHtml(title) + '" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" src="/p/' + token + '/content"></iframe></body></html>'
}

export async function sharedPageChannel(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: COMMON })
  const match = SHARED_PATH.exec(request.url)
  if (match === null) return notFound()
  const { token: given = '', part } = match.pathname.groups
  const signed = await signedShareToken(env.DATA_KEY, given)
  if (signed === undefined) return notFound()
  const shared = await env.MEMBER.getByName(signed.memberId).sharedPageOf(signed.token).catch(() => null)
  if (shared === null) return notFound()
  const robot = env.ROBOT.getByName(shared.robotId)
  try {
    if (part === 'pdf') {
      const { title, pdf } = await robot.pagePdf(shared.path)
      const response = pdfResponse(title, pdf)
      for (const [name, value] of Object.entries(COMMON)) response.headers.set(name, value)
      return response
    }
    const page = await robot.pageHtml(shared.path)
    if (part === 'content') return page.format === 'html' ? html(page.html, SANDBOX + '; ' + HTML_PAGE_CSP) : notFound()
    if (part !== undefined) return notFound()
    if (page.format === 'html') return html(frameDocument(page.title, signed.token), "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'")
    const withBar = page.html.replace('<body>', '<body><p style="text-align:right;margin:0 0 1rem"><a href="/p/' + signed.token + '/pdf">PDF</a></p>')
    return html(withBar, SANDBOX + '; ' + MARKDOWN_PAGE_CSP)
  } catch {
    // The file was deleted or moved, or the Robot is gone: the link leads nowhere.
    return notFound()
  }
}
