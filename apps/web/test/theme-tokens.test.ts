// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { definedVariables, resolveTheme, TOKENS, tokenCss, type ResolvedTheme } from '../src/theme/theme-css.ts'

const src = join(import.meta.dirname, '../src')
const read = (path: string) => readFileSync(join(src, path), 'utf8')
const used = (css: string) => new Set([...css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))
const declared = (css: string) => new Set([...css.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((match) => match[1]!))
const cssFiles = (dir: string): string[] => readdirSync(join(src, dir)).flatMap((name) => {
  const path = join(dir, name)
  return statSync(join(src, path)).isDirectory() ? cssFiles(path) : name.endsWith('.css') ? [path] : []
})
const themes: ResolvedTheme[] = ['light', 'dark']

describe('design tokens (ap-qb2y, ap-p00m)', () => {
  it('defines the same colour roles in the light and the dark theme', () => {
    expect(Object.keys(TOKENS.themes.light.color).sort()).toEqual(Object.keys(TOKENS.themes.dark.color).sort())
  })

  it.each(themes)('defines, in the %s theme, every variable the app stylesheet uses', (theme) => {
    const css = read('styles.css')
    const own = declared(css)
    const missing = [...used(css)].filter((name) => !own.has(name) && !definedVariables(theme).includes(name))
    expect(missing).toEqual([])
  })

  it('keeps the vendored trajectory styles on their own palette or the token file', () => {
    const own = declared(read('dsh/theme.css'))
    const tokenNames = new Set([...definedVariables('light'), ...definedVariables('dark')])
    const own_prefixes = ['--dsw-alias-', '--dsw-static-']
    const missing = cssFiles('dsh').flatMap((file) => [...used(read(file))]
      .filter((name) => own_prefixes.some((prefix) => name.startsWith(prefix)) ? !own.has(name) : tokenNames.has(name) ? false : /^--(bg|text|muted|faint|line|surface)/.test(name))
      .map((name) => `${file}: ${name}`))
    expect(missing).toEqual([])
  })

  it('generates both themes from the file, dark as the fallback', () => {
    const css = tokenCss()
    expect(css).toContain(':root, [data-theme=dark] {')
    expect(css).toContain('[data-theme=light] {')
    for (const theme of themes) for (const name of definedVariables(theme)) expect(css).toContain(`${name}:`)
  })

  it('follows the system unless a theme is pinned', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
