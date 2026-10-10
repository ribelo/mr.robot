/**
 * Google's callback (v1.5 ticket 02, v1.10 ticket 01): outside the Access login, so a consent that the
 * desktop app opened in the system browser finishes there without signing in to Mr. Robot again
 * (pa-4sr1). The one-time state names the Member and is checked by that Member.
 */
import type { Env } from '../env.ts'

export const GOOGLE_CALLBACK_PATH = '/api/connections/google/oauth/callback'

function page(title: string, text: string): Response {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)
  return new Response(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.3rem">${escape(title)}</h1><p>${escape(text)}</p></body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function googleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const back = (query: string) => Response.redirect(`${url.origin}/#/me?${query}`, 302)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const memberId = state?.split('.')[0] ?? ''
  if (code === null || state === null || memberId === '' || !state.includes('.')) {
    const reason = url.searchParams.get('error') === 'access_denied' ? 'you declined on Google\'s screen; nothing was connected' : 'Google sent no sign-in code'
    return back(`connection-error=${encodeURIComponent(reason)}`)
  }
  try {
    const done = await env.MEMBER.getByName(memberId).finishGoogleConsent(url.origin, code, state)
    if (done.external) return page(`Connected ${done.account}`, 'Return to the Mr. Robot app; the account is in your connections. You can close this tab.')
    return back(`connected=${encodeURIComponent(done.account)}`)
  } catch (error) {
    return back(`connection-error=${encodeURIComponent(error instanceof Error ? error.message : 'the sign-in did not complete')}`)
  }
}
