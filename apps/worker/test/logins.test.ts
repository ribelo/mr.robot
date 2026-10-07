import { describe, expect, it } from 'vitest'
import { entryMatches, parseEntry, registrableDomain, serializeEntry } from '../src/platform/logins.ts'

describe('login entries (rb-gq50, rb-1dzv, rb-36g4)', () => {
  it('reads a secret stored before entries as a readable password', () => {
    expect(parseEntry('hunter22')).toEqual({ username: '', password: 'hunter22', websites: [], notes: '', allowRead: true })
    const entry = { username: 'anna', password: 'p', websites: ['https://online.mbank.pl'], notes: '', allowRead: false }
    expect(parseEntry(serializeEntry(entry))).toEqual(entry)
  })

  it('matches by registrable domain', () => {
    expect(registrableDomain('https://online.mbank.pl/pl/Login')).toBe('mbank.pl')
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk')
    expect(registrableDomain('https://www.gov.pl')).toBe('www.gov.pl')
    const entry = { websites: ['mbank.pl'] }
    expect(entryMatches(entry, 'https://online.mbank.pl/pl/Login')).toBe(true)
    expect(entryMatches(entry, 'https://mbank.pl.evil.com/login')).toBe(false)
    expect(entryMatches({ websites: [] }, 'https://mbank.pl')).toBe(false)
  })
})
