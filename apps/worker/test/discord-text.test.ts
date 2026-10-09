import { describe, expect, it } from 'vitest'
import { DISCORD_MESSAGE_LIMIT, discordMessages, fenceTables, splitMessage } from '../src/connectors/discord-text.ts'

const squash = (text: string) => text.replace(/\s+/g, '')

describe('Markdown tables for Discord', () => {
  it('wraps a table in a code block and leaves the text around it alone', () => {
    const table = '| Flat | Rent |\n|------|------|\n| Prosta | 3000 |\n| Wola | 2800 |'
    expect(fenceTables(`Two flats:\n\n${table}\n\nWhich one?`)).toBe(`Two flats:\n\n\`\`\`\n${table}\n\`\`\`\n\nWhich one?`)
  })

  it('does not touch pipes that are not a table, or a table already in a code block', () => {
    expect(fenceTables('| just a pipe\n| another one')).toBe('| just a pipe\n| another one')
    const fenced = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'
    expect(fenceTables(fenced)).toBe(fenced)
  })

  it('wraps every table of a message', () => {
    const one = '| a |\n|---|\n| 1 |'
    expect(fenceTables(`${one}\n\ntext\n\n${one}`).match(/```/g)).toHaveLength(4)
  })
})

describe('Splitting for the 2000 character limit', () => {
  it('keeps a short text in one message', () => {
    expect(splitMessage('hello')).toEqual(['hello'])
    expect(splitMessage('')).toEqual([])
  })

  it('splits at paragraph breaks first', () => {
    const text = ['a'.repeat(1200), 'b'.repeat(1200), 'c'.repeat(100)].join('\n\n')
    expect(splitMessage(text)).toEqual(['a'.repeat(1200), 'b'.repeat(1200) + '\n\n' + 'c'.repeat(100)])
  })

  it('splits at lines when a paragraph is too long, and anywhere when a line is', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index} ${'x'.repeat(60)}`)
    const parts = splitMessage(lines.join('\n'))
    expect(parts.every((part) => part.length <= DISCORD_MESSAGE_LIMIT)).toBe(true)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => part.split('\n').every((line) => lines.includes(line)))).toBe(true)
    const hard = splitMessage('y'.repeat(4500))
    expect(hard.map((part) => part.length)).toEqual([2000, 2000, 500])
  })

  it('closes a code block it cuts and opens it again in the next message', () => {
    const code = Array.from({ length: 120 }, (_, index) => `const value${index} = ${index} // padding padding`)
    const text = ['Intro.', '```ts', ...code, '```', 'Outro.'].join('\n')
    const parts = splitMessage(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
      expect(part.split('\n').filter((line) => line.startsWith('```')).length % 2).toBe(0)
    }
    expect(parts[1]!.startsWith('```ts\n')).toBe(true)
    expect(squash(parts.join('').replaceAll('```ts', '').replaceAll('```', ''))).toBe(squash(text.replaceAll('```ts', '').replaceAll('```', '')))
  })

  it('fences a wide table and still splits it inside the fence', () => {
    const rows = Array.from({ length: 80 }, (_, index) => `| row ${index} | ${'v'.repeat(40)} |`)
    const parts = discordMessages(['| name | value |', '|---|---|', ...rows].join('\n'))
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
      expect(part.startsWith('```')).toBe(true)
      expect(part.endsWith('```')).toBe(true)
    }
  })
})
