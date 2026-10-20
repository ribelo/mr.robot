/**
 * The pure part of the file tools (v1.16 ticket 01): worked examples, with expectations from the definitions of the tools (a glob's * stays in a
 * segment, a shell's single quotes end at the next single quote), not from the code.
 */
import { describe, expect, it } from 'vitest'
import { globBase, globToRegExp, readWindow, replaceText } from '../src/places/file-ops.ts'

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


describe('read window', () => {
  const text = Array.from({ length: 5 }, (_, index) => `line ${index + 1}`).join('\n') + '\n'

  it('numbers lines from 1, says where the file ends, and tells how to continue', () => {
    const whole = readWindow('/workspace/a.txt', text)
    expect(whole).toContain('1: line 1\n2: line 2')
    expect(whole).toContain('(End of file - total 5 lines)')
    const part = readWindow('/workspace/a.txt', text, 2, 2)
    expect(part).toContain('2: line 2\n3: line 3')
    expect(part).not.toContain('4: line 4')
    expect(part).toContain('(Showing lines 2-3 of 5. Use offset=4 to continue.)')
  })

  it('refuses an offset past the end, and reads an empty file', () => {
    expect(() => readWindow('/workspace/a.txt', text, 9)).toThrow('offset 9 is out of range')
    expect(readWindow('/workspace/empty.txt', '')).toContain('(End of file - total 0 lines)')
  })
})

describe('replaceText', () => {
  it('replaces one match, refuses none or many unless told to replace all', () => {
    expect(replaceText('a b c', 'b', 'X', false)).toBe('a X c')
    expect(() => replaceText('a b c', 'z', 'X', false)).toThrow('not found')
    expect(() => replaceText('b b', 'b', 'X', false)).toThrow('occurs 2 times')
    expect(replaceText('b b', 'b', 'X', true)).toBe('X X')
    expect(replaceText('price $1', '$1', '$&', false)).toBe('price $&')
  })
})
