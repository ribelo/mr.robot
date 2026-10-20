/**
 * Pages (v1.17 ticket 05): files under pages/ with a title, listed with titles and dates, renamed in place, handed over by say as a Page card.
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, PageContent, PageView, WorkspaceFileView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { files: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const REPORT = '---\ntitle: "Flat search: October"\ndate: 2026-10-20\n---\n\n# Flats\n\nThree flats are still free.\n\n## Prices\n\n| Flat | Rent |\n|---|---|\n| A | 3 200 zł |\n'
const PLAN = '# Trip plan\n\nFly on Friday, back on Sunday.\n'
const SITE = '<!doctype html><html><head><title>Budget &amp; costs</title></head><body><h1>Budget</h1><p>We spend less in November.</p><script>document.body.dataset.ok = "1"</script></body></html>'

async function write(id: string, path: string, content: string): Promise<void> {
  scripts.set(id, [{ calls: [{ name: 'write', args: { on: 'workspace', file_path: path, content } }] }, { text: '' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: `write ${path}` } })
  await settle(id)
}

describe('Pages (dp-53pf, dp-lxw4, dp-e0rp, dp-35i9, dp-t2w1)', () => {
  it('lists the .md and .html files under pages/ with their titles, newest first, and nothing else', async () => {
    const id = await activeRobot()
    await write(id, 'pages/report.md', REPORT)
    await write(id, 'pages/trips/plan.md', PLAN)
    await write(id, 'pages/site.html', SITE)
    await write(id, 'notes/report.md', '# Not a Page')
    await write(id, 'pages/data.csv', 'a,b')
    const pages = (await api<PageView[]>(ANNA, `/api/robots/${id}/pages`)).body
    expect(pages.map((page) => [page.path, page.title, page.format])).toEqual([
      ['pages/site.html', 'Budget & costs', 'html'],
      ['pages/trips/plan.md', 'Trip plan', 'markdown'],
      ['pages/report.md', 'Flat search: October', 'markdown'],
    ])
    expect(pages.find((page) => page.path === 'pages/report.md')!.excerpt).toContain('Three flats are still free.')
    expect(pages.find((page) => page.path === 'pages/site.html')!.excerpt).toBe('We spend less in November.')
    const opened = await api<PageContent>(ANNA, `/api/robots/${id}/page?path=pages/report.md`)
    expect(opened.body).toMatchObject({ page: { title: 'Flat search: October' }, text: REPORT })
    expect((await api(ANNA, `/api/robots/${id}/page?path=notes/report.md`)).status).toBe(404)
    // The Files view groups them, so it offers Open as Page.
    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body
    expect(files.filter((file) => file.group === 'pages').map((file) => file.path).sort()).toEqual(['pages/report.md', 'pages/site.html', 'pages/trips/plan.md'])
  })

  it('renames a Page in the file: the front matter title, the first heading, the <title>', async () => {
    const id = await activeRobot()
    await write(id, 'pages/report.md', REPORT)
    await write(id, 'pages/trips/plan.md', PLAN)
    await write(id, 'pages/site.html', SITE)
    const rename = (path: string, title: string) => api<PageView>(ANNA, `/api/robots/${id}/page/rename`, { body: { path, title } })
    expect((await rename('pages/report.md', 'Flats: final list')).body.title).toBe('Flats: final list')
    expect(await testRobot(id).fileForTest('pages/report.md')).toBe(REPORT.replace('title: "Flat search: October"', 'title: "Flats: final list"'))
    await rename('pages/trips/plan.md', 'Weekend in Kraków')
    expect(await testRobot(id).fileForTest('pages/trips/plan.md')).toBe('# Weekend in Kraków\n\nFly on Friday, back on Sunday.\n')
    await rename('pages/site.html', 'Budget <2027>')
    expect(await testRobot(id).fileForTest('pages/site.html')).toContain('<title>Budget &lt;2027&gt;</title>')
    expect((await api<PageView[]>(ANNA, `/api/robots/${id}/pages`)).body.map((page) => page.title).sort()).toEqual(['Budget <2027>', 'Flats: final list', 'Weekend in Kraków'])
    expect((await rename('notes/x.md', 'No')).status).toBe(404)
  })

  it('a say attachment under pages/ is a Page card with its title and first lines; the card follows a rename', async () => {
    const id = await activeRobot()
    await write(id, 'pages/report.md', REPORT)
    scripts.set(id, [{ calls: [{ name: 'say', args: { text: 'Here is the report.', attachments: ['pages/report.md'] } }] }, { text: '' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'send me the report' } })
    await settle(id)
    const card = async () => (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.flatMap((item) => (item.kind === 'reply' ? item.attachments ?? [] : [])).find((file) => file.path === 'pages/report.md')
    expect(await card()).toMatchObject({ path: 'pages/report.md', page: { title: 'Flat search: October', excerpt: expect.stringContaining('Three flats') } })
    await api(ANNA, `/api/robots/${id}/page/rename`, { body: { path: 'pages/report.md', title: 'Flats' } })
    expect((await card())!.page!.title).toBe('Flats')
  })

  it('only the owner renames', async () => {
    const id = await activeRobot()
    await write(id, 'pages/plan.md', PLAN)
    await api(ANNA, '/api/admin/members', { body: { email: 'ben@example.com' } })
    await api('ben@example.com', '/api/me')
    expect([403, 404]).toContain((await api('ben@example.com', `/api/robots/${id}/page/rename`, { body: { path: 'pages/plan.md', title: 'Mine' } })).status)
    expect(await testRobot(id).fileForTest('pages/plan.md')).toBe(PLAN)
  })
})
