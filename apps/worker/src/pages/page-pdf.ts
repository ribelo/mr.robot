/**
 * A Page printed to PDF through Browser Rendering (v1.17, dp-239c): the document is set as the page's content, the PDF waits until Mermaid has
 * drawn (or ten seconds), and the browser is closed. A seam: tests do not reach Browser Rendering; the staging check does.
 */
import puppeteer from '@cloudflare/puppeteer'

const DRAWN_MS = 10_000

export async function printPdf(binding: Fetcher, html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(binding as never)
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })
    await page.waitForFunction('window.pageReady === true || !document.querySelector("script[type=module]")', { timeout: DRAWN_MS }).catch(() => undefined)
    return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } }))
  } finally {
    await browser.close().catch(() => undefined)
  }
}
