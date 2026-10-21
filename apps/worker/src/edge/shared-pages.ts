/**
 * Shared Pages (v1.17 ticket 06, dp-jl3d, dp-p5yn): /p/<token> is outside the Access login (a bypass application in infra/stack.ts). The token's
 * signature is checked before any Durable Object is named; the Member that shares finds the share by the token's hash, and a revoked one is gone.
 * The answer is the Page's title, its content and its PDF, nothing of the app: no cookies are set, nothing is cached, and the Page runs in a
 * sandbox with an opaque origin, so its script can reach neither the app nor its API.
 *
 * - /p/<token>: a Markdown Page rendered on the server; an HTML Page in a frame under a header with its title and the PDF link.
 * - /p/<token>/content: an HTML Page itself, under a Content-Security-Policy sandbox.
 * - /p/<token>/pdf: the Page printed by Browser Rendering, once per content version, within the render and spend limits (429 and 503 otherwise).
 */
import { escapeHtml } from '../platform/markdown-html.ts'
import { HTML_PAGE_CSP, markdownPageCsp } from '../pages/page-html.ts'
import { shareTokenHash, signedShareToken } from '../pages/share-token.ts'
import { SPACE_ID, type Env } from '../env.ts'
import { pdfResponse } from './api.ts'

const SHARED_PATH = new URLPattern({ pathname: '/p/:token/:part?' })

export const isSharedPagePath = (path: string): boolean => path.startsWith('/p/')

/** Sandbox without allow-same-origin: the document gets an opaque origin (CSP Level 3, sandbox directive). */
const SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'

const COMMON: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' }

const text = (message: string, status: number): Response => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...COMMON } })

const notFound = (): Response => text('This page is not shared, or no longer.', 404)

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
  // Only these three addresses exist under /p; anything else is not found before a token is even checked.
  if (part !== undefined && part !== 'content' && part !== 'pdf') return notFound()
  const signed = await signedShareToken(env.DATA_KEY, given)
  if (signed === undefined) return notFound()
  const shared = await env.MEMBER.getByName(signed.memberId).sharedPageOf(signed.token).catch(() => null)
  if (shared === null) return notFound()
  // The share follows its owner: a Member no longer in the Space shares nothing (v1.20.1, cross-review #3).
  if (!(await env.SPACE.getByName(SPACE_ID).memberActive(signed.memberId).catch(() => false))) return notFound()
  const robot = env.ROBOT.getByName(shared.robotId)
  const origin = new URL(request.url).origin
  try {
    if (part === 'pdf') {
      const printed = await robot.pagePdf(shared.path, origin, { tokenHash: await shareTokenHash(signed.token) })
      switch (printed.kind) {
        case 'pdf': {
          const response = pdfResponse(printed.title, printed.pdf)
          for (const [name, value] of Object.entries(COMMON)) response.headers.set(name, value)
          return response
        }
        case 'limited': return text(printed.message, 429)
        // Over the Robot's spend limit: no PDF, and the Page itself still serves.
        case 'unavailable': return text('PDF unavailable.', 503)
      }
    }
    const page = await robot.pageHtml(shared.path, origin)
    if (part === 'content') return page.format === 'html' ? html(page.html, SANDBOX + '; ' + HTML_PAGE_CSP) : notFound()
    if (page.format === 'html') return html(frameDocument(page.title, signed.token), "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'")
    const withBar = page.html.replace('<body>', '<body><p style="text-align:right;margin:0 0 1rem"><a href="/p/' + signed.token + '/pdf">PDF</a></p>')
    return html(withBar, SANDBOX + '; ' + markdownPageCsp("'self'"))
  } catch {
    // The file was deleted or moved, or the Robot is gone: the link leads nowhere.
    return notFound()
  }
}