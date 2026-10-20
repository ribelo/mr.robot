/**
 * Page PDFs (v1.17 review 1): printed by Browser Rendering at most once per content version and served from the cache after; at most 5 renders
 * per share link an hour and 50 per Member a day; each render's browser time is the Robot's cost; over the spend limit there is no new PDF.
 */
import { env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, RobotPanel, SharedPageView } from '@mr-robot/protocol'
import { shareTokenHash } from '../src/pages/share-token.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'
import { printedPdfs, type Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  printedPdfs.length = 0
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

async function robotWithPage(): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await testRobot(body.id).activateForTest()
  await env.ROBOT.getByName(body.id).saveFile('pages/report.md', '# Report\n\nVersion 1.\n')
  return body.id
}

const ownerPdf = (id: string) => SELF.fetch(`https://mr-robot.test/api/robots/${id}/page/pdf?path=pages/report.md`, { headers: { 'x-dev-identity': ANNA } })
const open = (url: string) => SELF.fetch(url, { headers: { 'x-dev-identity': 'stranger@example.org' } })
const member = () => env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>

describe('Page PDFs are printed once per content version (v1.17 review)', () => {
  it('serves the cached PDF of an unchanged Page and prints again after a change; the browser time is the Robot\'s cost', async () => {
    const id = await robotWithPage()
    const first = await ownerPdf(id)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('application/pdf')
    expect(await first.text()).toBe('%PDF-1.7 Report')
    expect(await (await ownerPdf(id)).text()).toBe('%PDF-1.7 Report')
    expect(printedPdfs).toHaveLength(1)
    // The share link uses the same cache.
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body
    expect((await open(`${url}/pdf`)).status).toBe(200)
    expect(printedPdfs).toHaveLength(1)
    await env.ROBOT.getByName(id).saveFile('pages/report.md', '# Report\n\nVersion 2.\n')
    expect((await open(`${url}/pdf`)).status).toBe(200)
    expect(printedPdfs).toHaveLength(2)
    expect(printedPdfs[1]).toContain('Version 2.')
    expect((await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.usage.breakdown.browser).toBeGreaterThan(0)
  })

  it('prints at most 5 times per share link an hour and 50 times per Member a day; a cached PDF is no render', async () => {
    const id = await robotWithPage()
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body
    const token = new URL(url).pathname.slice('/p/'.length)
    await member().pdfRendersForTest(5, await shareTokenHash(token))
    const limited = await open(`${url}/pdf`)
    expect(limited.status).toBe(429)
    expect(await limited.text()).toBe('This Page was printed to PDF too often in the last hour; try again later.')
    expect(printedPdfs).toEqual([])
    // The owner's own PDF is not a render of that link, and once printed it serves the link from the cache.
    expect((await ownerPdf(id)).status).toBe(200)
    expect((await open(`${url}/pdf`)).status).toBe(200)
    expect(printedPdfs).toHaveLength(1)
    // 44 more today make 50 with the 5 of the link and the owner's one: the next render of any Page is refused, the cached one still served.
    await member().pdfRendersForTest(44, null)
    await env.ROBOT.getByName(id).saveFile('pages/report.md', '# Report\n\nVersion 3.\n')
    const owner = await ownerPdf(id)
    expect(owner.status).toBe(429)
    expect(await owner.json()).toEqual({ error: 'The PDFs of these Pages were printed too often today; try again tomorrow.' })
    expect(printedPdfs).toHaveLength(1)
  })

  it('prints nothing new over the Robot\'s spend limit: the PDF is unavailable and the Page still serves', async () => {
    const id = await robotWithPage()
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${id}/page/share`, { body: { path: 'pages/report.md' } })).body
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { spendLimit: { kind: 'usd', amount: 5 } } })
    await testRobot(id).spendForTest(6)
    const pdf = await open(`${url}/pdf`)
    expect(pdf.status).toBe(503)
    expect(await pdf.text()).toBe('PDF unavailable.')
    expect(printedPdfs).toEqual([])
    expect((await open(url)).status).toBe(200)
  })
})
