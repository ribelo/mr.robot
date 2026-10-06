/**
 * The real Browser Rendering driver against public fixture pages (robot-l9te, robot-t0vc, robot-0eew).
 */
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { RenderingDriver } from '../../src/browser/driver.ts'

const driver = () => new RenderingDriver(env.BROWSER)

describe('Browser Rendering', () => {
  it('opens, observes, acts and takes a screenshot', async () => {
    const page = await driver().open(null)
    try {
      await page.goto('https://httpbin.org/forms/post')
      const form = await page.observe()
      const name = form.elements.find((element) => element.role === 'textbox' && /customer name/i.test(element.label))
      expect(name).toBeDefined()
      await page.act({ action: 'type', index: name!.index, text: 'Mr. Robot' })
      const typed = await page.observe()
      expect(typed.elements.find((element) => element.index === name!.index)?.value).toBe('Mr. Robot')
      const large = typed.elements.find((element) => element.role === 'radio' && /large/i.test(element.label))
      await page.act({ action: 'check', index: large!.index, checked: true })
      expect((await page.observe()).elements.find((element) => element.index === large!.index)?.checked).toBe('true')
      const png = await page.screenshot()
      expect([...png.slice(0, 4)]).toEqual([137, 80, 78, 71])
    } finally {
      await page.close()
    }
  }, 120_000)

  it('carries cookies into a new browser session through the saved state', async () => {
    const first = await driver().open(null)
    await first.goto('https://httpbin.org/cookies/set?mr_robot=logged-in')
    const state = await first.exportState()
    await first.close()
    expect(state.cookies.some((cookie) => cookie['name'] === 'mr_robot')).toBe(true)
    const second = await driver().open(state)
    try {
      await second.goto('https://httpbin.org/cookies')
      expect((await second.observe()).text).toContain('logged-in')
    } finally {
      await second.close()
    }
  }, 120_000)
})
