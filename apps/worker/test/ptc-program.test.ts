import { describe, expect, it } from 'vitest'
import { callIfOnlyAFunction } from '../src/agent/ptc.ts'

describe('a program sent as one function expression', () => {
  it('is called instead of only defined', () => {
    expect(callIfOnlyAFunction('async () => { return 1 }')).toBe('return await (async () => { return 1 })()')
    expect(callIfOnlyAFunction('async()=>{return 1}')).toBe('return await (async()=>{return 1})()')
    expect(callIfOnlyAFunction('async function main() { return 1 };')).toBe('return await (async function main() { return 1 })()')
    expect(callIfOnlyAFunction('return await tools.react({ emoji: "👍" })')).toBe('return await tools.react({ emoji: "👍" })')
  })
})
