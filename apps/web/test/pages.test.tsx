import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, PageContent } from '@mr-robot/protocol'
import { PageReading, framedHtml, pageImagePath } from '../src/components/PageReader.tsx'
import { PageList } from '../src/components/PageList.tsx'
import { ChatView } from '../src/components/ChatView.tsx'
import { isPagePath } from '../src/components/FilesView.tsx'

afterEach(cleanup)

const at = Date.parse('2026-10-20T10:00:00Z')
const markdown: PageContent = {
  page: { path: 'pages/report.md', title: 'Flat search', format: 'markdown', excerpt: 'Three flats', size: 200, updatedAt: at },
  text: '---\ntitle: Flat search\n---\n\n# Flat search\n\n## Prices\n\n| Flat | Rent |\n|---|---|\n| A | 3 200 zł |\n\n\u0060\u0060\u0060sh\n## not a heading\n\u0060\u0060\u0060\n\n## Where\n\n### Mokotów\n\nNear the park.\n',
}
const html: PageContent = {
  page: { path: 'pages/site.html', title: 'Budget', format: 'html', excerpt: '', size: 90, updatedAt: at },
  text: '<html><head><title>Budget</title></head><body><a href="https://example.com">x</a></body></html>',
}

describe('the reading view (dp-nnzg, dp-hv7b, dp-e0rp, dp-239c)', () => {
  it('shows a Markdown Page with its title, a table, and a table of contents from its headings outside code', () => {
    const { container } = render(<PageReading robotId="r-1" content={markdown} canEdit onRename={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Flat search' })).toBeTruthy()
    const contents = [...container.querySelectorAll('.page-toc li')].map((node) => node.textContent)
    expect(contents).toEqual(['Prices', 'Where', 'Mokotów'])
    expect(container.querySelector('.page-body table')).toBeTruthy()
    expect(container.querySelector('.page-body')?.textContent).not.toContain('title: Flat search')
    expect((screen.getByText('PDF') as HTMLAnchorElement).getAttribute('href')).toBe('/api/robots/r-1/page/pdf?path=pages%2Freport.md')
  })

  it('renames through the title field; only the owner sees Rename', async () => {
    const onRename = vi.fn(async () => ({ failure: undefined }))
    const { rerender } = render(<PageReading robotId="r-1" content={markdown} canEdit onRename={onRename} />)
    fireEvent.click(screen.getByText('Rename'))
    const field = screen.getByLabelText('Page title')
    fireEvent.change(field, { target: { value: 'Flats, final' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('Flats, final'))
    rerender(<PageReading robotId="r-1" content={markdown} canEdit={false} onRename={onRename} />)
    expect(screen.queryByText('Rename')).toBeNull()
  })

  it('runs an HTML Page in a sandboxed frame without the app\'s origin, with a policy that loads nothing, and shows its Source', () => {
    const { container } = render(<PageReading robotId="r-1" content={html} canEdit onRename={vi.fn()} />)
    const frame = container.querySelector('iframe.page-frame') as HTMLIFrameElement
    const sandbox = frame.getAttribute('sandbox') ?? ''
    expect(sandbox.split(' ')).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
    const doc = frame.getAttribute('srcdoc') ?? ''
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain('<base target="_blank">')
    fireEvent.click(screen.getByText('Source'))
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('.page-source')?.textContent).toBe(html.text)
  })

  it('puts the policy first in the head of any HTML and resolves image paths from the Page', () => {
    expect(framedHtml('<p>bare</p>')).toMatch(/^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/)
    expect(pageImagePath('pages/trips/plan.md', 'img/map.png')).toBe('pages/trips/img/map.png')
    expect(pageImagePath('pages/trips/plan.md', '../shared/a.png')).toBe('pages/shared/a.png')
    expect(pageImagePath('pages/plan.md', '/attachments/a.png')).toBe('attachments/a.png')
    expect(pageImagePath('pages/plan.md', 'https://example.com/a.png')).toBeUndefined()
  })
})

describe('Pages in the Conversation, the panel and the Files view (dp-35i9, dp-lxw4, dp-t2w1)', () => {
  it('shows a say attachment that is a Page as a card that opens the reading view', () => {
    const items: ChatItem[] = [{ kind: 'reply', id: 'r', seq: 1, at, text: 'Here it is.', attachments: [{ name: 'report.md', path: 'pages/report.md', size: 200, contentType: 'text/markdown', page: { title: 'Flat search', excerpt: 'Three flats are free.' } }] }]
    render(<ChatView items={items} meId="m-1" working={false} canAnswer robotId="r-1" now={at} />)
    const card = screen.getByLabelText('Page Flat search') as HTMLAnchorElement
    expect(card.getAttribute('href')).toBe('#/r/r-1/pages/pages/report.md')
    expect(card.textContent).toContain('Three flats are free.')
  })

  it('lists the Robot\'s Pages with their titles', () => {
    render(<PageList robotId="r-1" pages={[markdown.page, html.page]} />)
    expect((screen.getByText('Flat search').closest('a') as HTMLAnchorElement).getAttribute('href')).toBe('#/r/r-1/pages/pages/report.md')
    expect(screen.getByText('Budget')).toBeTruthy()
    cleanup()
    render(<PageList robotId="r-1" pages={[]} />)
    expect(screen.getByText('No Pages yet.')).toBeTruthy()
  })

  it('knows which Files are Pages', () => {
    expect(isPagePath('pages/report.md')).toBe(true)
    expect(isPagePath('pages/a/site.html')).toBe(true)
    expect(isPagePath('notes/report.md')).toBe(false)
    expect(isPagePath('pages/data.csv')).toBe(false)
  })
})
