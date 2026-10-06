import { describe, expect, it } from 'vitest'
import { bingTarget } from '../src/agent/web.ts'

describe('keyless search through Bing (robot-o6lf)', () => {
  it('unwraps Bing result links to the real address', () => {
    const target = 'https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/mazowieckie/warszawa/mokotow'
    const wrapped = `https://www.bing.com/ck/a?!&&p=abc&u=a1${btoa(target).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}&ntb=1`
    expect(bingTarget(wrapped)).toBe(target)
    expect(bingTarget('https://example.com/page')).toBe('https://example.com/page')
  })
})
