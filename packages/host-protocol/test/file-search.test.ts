/**
 * The glob of the file tools, worked examples with expectations from the definition of a glob (a * stays in a segment, a ** crosses them),
 * not from the code.
 */
import { describe, expect, it } from 'vitest'
import { globBase, globToRegExp } from '../src/index.ts'

describe('glob', () => {
  const matches = (pattern: string, path: string) => globToRegExp(pattern).test(path)

  it('keeps * inside one segment and lets ** cross segments', () => {
    expect(matches('notes/*.md', 'notes/a.md')).toBe(true)
    expect(matches('notes/*.md', 'notes/old/a.md')).toBe(false)
    expect(matches('notes/**', 'notes/old/a.md')).toBe(true)
    expect(matches('**/*.md', 'a.md')).toBe(true)
    expect(matches('**/*.md', 'x/y/a.md')).toBe(true)
    expect(matches('a?c', 'abc')).toBe(true)
    expect(matches('a?c', 'a/c')).toBe(false)
  })

  it('takes a dot in a pattern as a dot', () => {
    expect(matches('a.md', 'a.md')).toBe(true)
    expect(matches('a.md', 'aXmd')).toBe(false)
  })

  it('starts a search at the directory before the first wildcard', () => {
    expect(globBase('/home/anna/projects/**/*.ts')).toBe('/home/anna/projects')
    expect(globBase('docs/*.md')).toBe('docs')
    expect(globBase('**/*.md')).toBe('.')
    expect(globBase('*.md')).toBe('.')
    expect(globBase('/*.md')).toBe('/')
    expect(globBase('/etc/hostname')).toBe('/etc/hostname')
  })
})
