/**
 * Shared Pages (v1.17 ticket 06): the owner shares a Page with a signed, revocable public link; /p/<token> serves the title, the content and the PDF
 * without the Access login and nothing of the app; an HTML Page runs under a sandboxing policy; a Robot cannot share.
 */
import { env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SharedPageView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

async function robotWithPages(): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  await env.ROBOT.getByName(body.id).saveFile('pages/report.md', '# Flats\n\n| Flat | Rent |\n|---|---|\n| A | 3 200 zł |\n\n<script>alert(1)</script>\n')
  await env.ROBOT.getByName(body.id).saveFile('pages/site.html', '<html><head><title>Budget</title></head><body><p>Less in November.</p><script>fetch("/api/me")</script></body></html>')
  return body.id
}

/** A request from a stranger: no Mr. Robot session, an e-mail that is no Member of the Home. */
const open = (url: string) => SELF.fetch(url, { headers: { 'x-dev-identity': 'stranger@example.org' } })

describe('shared Pages (dp-hf7v, dp-jl3d, dp-zq16, dp-62di, dp-p5yn)', () => {
  it('the owner mints a link; it serves the Markdown Page to anyone, without the app, cookies or raw HTML', async () => {
    const id = await robotWithPages()
    expect((await open('https://mr-robot.test/api/me')).status).toBe(403)
    const shared = await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })
    expect(shared.status).toBe(200)
    expect(shared.body).toMatchObject({ robotId: id, path: 'pages/report.md', title: 'Flats', url: expect.stringMatching(/^https:\/\/mr-robot\.test\/p\/m-[0-9a-f-]+\.[0-9a-f]{64}\.[0-9a-f]{64}$/) })
    // Sharing again gives the same link.
    expect((await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body.url).toBe(shared.body.url)
    const page = await open(shared.body.url)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('set-cookie')).toBeNull()
    const policy = page.headers.get('content-security-policy') ?? ''
    expect(policy).toContain('sandbox allow-scripts')
    // KaTeX and Mermaid come from this origin, never from a CDN (v1.17 review 3).
    expect(policy).toContain("script-src 'unsafe-inline' 'self'")
    expect(policy).not.toContain('https:')
    const text = await page.text()
    expect(text).toContain('href="https://mr-robot.test/vendor/katex-0.16.47/katex.min.css"')
    expect(text).toContain('import("https://mr-robot.test/vendor/mermaid-12.2.0/mermaid.esm.min.mjs")')
    expect(text).not.toContain('jsdelivr')
    expect(text).toContain('<title>Flats</title>')
    expect(text).toContain('<table>')
    expect(text).toContain('/pdf">PDF</a>')
    expect(text).not.toContain('<script>alert(1)</script>')
    expect(text).not.toContain('/api/')
  })

  it('serves an HTML Page framed under its title, and the Page itself under a sandboxing policy', async () => {
    const id = await robotWithPages()
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/site.html' } })).body
    const frame = await (await open(url)).text()
    expect(frame).toContain('<h1>Budget</h1>')
    expect(frame).toMatch(/<iframe[^>]*sandbox="allow-scripts[^"]*"[^>]*src="\/p\/[^"]+\/content"/)
    const content = await open(`${url}/content`)
    const policy = content.headers.get('content-security-policy') ?? ''
    expect(policy.startsWith('sandbox allow-scripts')).toBe(true)
    expect(policy).not.toContain('allow-same-origin')
    expect(policy).toContain("default-src 'none'")
    expect(await content.text()).toContain('<p>Less in November.</p>')
    expect(content.headers.get('set-cookie')).toBeNull()
  })

  it('Stop sharing revokes the link; a made-up or altered token is not found; the profile lists what is shared', async () => {
    const id = await robotWithPages()
    const report = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body
    const site = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/site.html' } })).body
    expect((await api<SharedPageView[]>(ANNA, '/api/me/shared-pages')).body.map((entry) => entry.path).sort()).toEqual(['pages/report.md', 'pages/site.html'])
    expect((await api<SharedPageView[]>(BEN, '/api/me/shared-pages')).body).toEqual([])
    expect((await api<{ shared: SharedPageView | null }>(ANNA, `/api/robots/${id}/page/share?path=pages/site.html`)).body.shared?.url).toBe(site.url)
    // A rename shows in the profile's list too.
    await api(ANNA, `/api/robots/${id}/page/rename`, { body: { path: 'pages/site.html', title: 'Budget 2027' } })
    expect((await api<SharedPageView[]>(ANNA, '/api/me/shared-pages')).body.find((entry) => entry.path === 'pages/site.html')?.title).toBe('Budget 2027')
    expect((await api(ANNA, `/api/robots/${id}/page/share`, { method: 'DELETE', body: { path: 'pages/report.md' } })).status).toBe(200)
    expect((await open(report.url)).status).toBe(404)
    expect((await open(`${report.url}/pdf`)).status).toBe(404)
    expect((await api<SharedPageView[]>(ANNA, '/api/me/shared-pages')).body.map((entry) => entry.path)).toEqual(['pages/site.html'])
    const altered = site.url.replace(/.$/, (last) => (last === '0' ? '1' : '0'))
    expect((await open(altered)).status).toBe(404)
    expect((await open('https://mr-robot.test/p/not-a-token')).status).toBe(404)
    // A deleted file leaves its link leading nowhere.
    await env.ROBOT.getByName(id).deleteFile('pages/site.html')
    expect((await open(site.url)).status).toBe(404)
  })

  it('renders a shared Markdown Page once per content version: a view of an unchanged Page reads the cache, a change of the file or of an image is served at once', async () => {
    const id = await robotWithPages()
    const robot = env.ROBOT.getByName(id)
    await robot.saveFile('pages/plan.md', '# Plan\n\n![Map](img/map.png)\n')
    await env.FILES.put(`robots/${id}/pages/img/map.png`, new Uint8Array([137, 80, 78, 71, 1]), { httpMetadata: { contentType: 'image/png' } })
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/plan.md' } })).body
    const first = await (await open(url)).text()
    expect(first).toContain('src="data:image/png;base64,iVBORwE="')
    const cached = (await env.FILES.list({ prefix: `page-cache/${id}/` })).objects.map((object) => object.key)
    expect(cached).toHaveLength(1)
    expect(await (await open(url)).text()).toBe(first)
    await env.FILES.put(`robots/${id}/pages/img/map.png`, new Uint8Array([137, 80, 78, 71, 2]), { httpMetadata: { contentType: 'image/png' } })
    expect(await (await open(url)).text()).toContain('src="data:image/png;base64,iVBORwI="')
    await robot.saveFile('pages/plan.md', '# Plan\n\nNo map any more.\n')
    expect(await (await open(url)).text()).toContain('No map any more.')
  })

  it('sharing is the owner\'s act: another Member cannot, and no Robot tool shares', async () => {
    const id = await robotWithPages()
    expect([403, 404]).toContain((await api(BEN, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).status)
    expect((await api(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'notes/x.md' } })).status).toBe(404)
    const mr = (await api<Array<{ id: string; kind: string }>>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await settle(mr)
    for (const robot of [id, mr]) expect((await env.ROBOT.getByName(robot).toolNames()).filter((name) => /page|share_|_share\b/i.test(name))).toEqual([])
  })
})
