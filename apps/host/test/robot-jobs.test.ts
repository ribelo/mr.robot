/**
 * Jobs on this computer (v1.16 ticket 03, ob-sja4, ob-ku5j, ob-6kkn): the real jobs-local registry and bash behind the Run, JobList, JobOutput
 * and JobKill calls, joined to the Host app's handlers as the Worker's calls reach them.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { access, connected, jobName } from './connected.ts'
import { wholeCharacters } from '../src/jobs.ts'

let home = ''
let host: Awaited<ReturnType<typeof connected>>
type Call = Record<string, unknown>
const call = (rpc: string, payload: Call) => Effect.runPromise(host.rpc[rpc]!(payload))
const failure = (rpc: string, payload: Call) => Effect.runPromise(Effect.flip(host.rpc[rpc]!(payload))) as Promise<{ message: string; code?: string }>
const run = (command: string, extra: Call = {}) => {
  const job = typeof extra['job'] === 'string' ? extra['job'] : jobName()
  return call('Run', { command, background: false, access: access({ mode: 'full' }), ...extra, job }).then((outcome) => ({ job, outcome }))
}
const info = async (job: string) => ((await call('JobList', { robot: 'bot' })) as { jobs: Array<{ job: string; state: string; exitCode: number | null }> }).jobs.find((entry) => entry.job === job)
const out = (job: string, offset: number, stream: 'out' | 'err' = 'out') => call('JobOutput', { job, stream, offset }) as Promise<{ text: string; bytes: number; size: number }>

beforeAll(async () => {
  home = await mkdtemp(join(homedir(), '.mr-robot-host-test-'))
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
})

describe('a command that ends within its call', () => {
  it('answers with its result and leaves no job behind', async () => {
    const { job, outcome } = await run('echo quick')
    expect(outcome).toMatchObject({ kind: 'foreground', exitCode: 0, stdout: { text: 'quick\n' } })
    expect(await info(job)).toBeUndefined()
    expect(host.ended).toEqual([])
  })
})

describe('a command still running at the limit (ob-sja4)', () => {
  it('goes on as a job; its end is told with a job frame, and nothing was told before', async () => {
    const { job, outcome } = await run('echo started; sleep 1; echo finished; exit 3', { timeoutMs: 300 })
    expect(outcome).toMatchObject({ kind: 'promoted', jobId: job, output: 'started\n' })
    expect(await info(job)).toMatchObject({ state: 'running', exitCode: null })
    expect(host.ended).toEqual([])
    await vi.waitFor(() => expect(host.ended).toEqual([{ job, state: 'completed', exitCode: 3, signal: null }]), { timeout: 5000 })
    expect(await info(job)).toMatchObject({ state: 'completed', exitCode: 3 })
    expect((await out(job, 0)).text).toBe('started\nfinished\n')
  })
})

describe('a job started at once (ob-sja4)', () => {
  it('answers at once, shows its output from any offset, and ends with a job frame', async () => {
    const started = Date.now()
    const { job, outcome } = await run('echo one; sleep 0.6; echo two; echo oops >&2', { background: true })
    expect(outcome).toMatchObject({ kind: 'background', jobId: job })
    expect(Date.now() - started).toBeLessThan(500)
    await vi.waitFor(async () => expect((await out(job, 0)).text).toBe('one\n'), { timeout: 3000 })
    // Output since the last read: the Worker asks from the offset it keeps (ob-6kkn).
    const first = await out(job, 0)
    expect(first).toEqual({ text: 'one\n', bytes: 4, size: 4 })
    expect(await out(job, first.bytes)).toEqual({ text: '', bytes: 0, size: 4 })
    await vi.waitFor(() => expect(host.ended.map((ended) => ended.job)).toContain(job), { timeout: 5000 })
    expect(await out(job, first.bytes)).toEqual({ text: 'two\n', bytes: 4, size: 8 })
    expect(await out(job, 0, 'err')).toEqual({ text: 'oops\n', bytes: 5, size: 5 })
  })

  it('is stopped by JobKill, which is not a frame, and a second kill says it had ended', async () => {
    const before = host.ended.length
    const { job } = await run('sleep 60', { background: true })
    expect(await call('JobKill', { job })).toEqual({ outcome: 'requested' })
    await vi.waitFor(async () => expect(await info(job)).toMatchObject({ state: 'killed' }), { timeout: 5000 })
    expect(await call('JobKill', { job })).toEqual({ outcome: 'already-finished' })
    expect(host.ended).toHaveLength(before)
  })

  it('lists only the jobs of the Robot that asks', async () => {
    const mine = await run('sleep 30', { background: true })
    const other = await run('sleep 30', { background: true, job: jobName('someone-else') })
    const listed = ((await call('JobList', { robot: 'bot' })) as { jobs: Array<{ job: string }> }).jobs.map((entry) => entry.job)
    expect(listed).toContain(mine.job)
    expect(listed).not.toContain(other.job)
    await call('JobKill', { job: mine.job })
    await call('JobKill', { job: other.job })
  })
})

describe('a long output (ob-ku5j)', () => {
  it('is read whole in pieces, from the file the app keeps once it outgrew memory', async () => {
    const { job } = await run('i=0; while [ $i -lt 20000 ]; do echo "line number $i: ö"; i=$((i+1)); done', { background: true })
    await vi.waitFor(async () => expect(await info(job)).toMatchObject({ state: 'completed' }), { timeout: 20_000 })
    let offset = 0
    let text = ''
    let pieces = 0
    for (;;) {
      const piece = await out(job, offset)
      pieces++
      text += piece.text
      offset += piece.bytes
      if (piece.bytes === 0 || offset >= piece.size) break
    }
    const expected = Array.from({ length: 20000 }, (_, index) => `line number ${index}: ö\n`).join('')
    expect(text.length).toBe(expected.length)
    expect(text).toBe(expected)
    expect(offset).toBe(new TextEncoder().encode(expected).length)
    // More than one piece: the beginning came from the file, not from memory.
    expect(pieces).toBeGreaterThan(1)
  })
})

describe('a call that is gone', () => {
  it('stops the command it was still waiting for', async () => {
    const abort = new AbortController()
    const job = jobName()
    const waiting = host.shell.run({ command: 'sleep 60', background: false, job, access: access({ mode: 'full' }), timeoutMs: 30_000, signal: abort.signal })
    await new Promise((resolve) => setTimeout(resolve, 200))
    abort.abort()
    await expect(waiting).rejects.toBeDefined()
    expect(await info(job)).toBeUndefined()
  })
})

describe('a job the app does not hold (ob-cgn1)', () => {
  it('fails every job call with NO_SUCH_JOB, as after a restart of the app', async () => {
    for (const [rpc, payload] of [['JobOutput', { job: 'bot:j-gone', stream: 'out', offset: 0 }], ['JobKill', { job: 'bot:j-gone' }]] as const) {
      expect(await failure(rpc, payload)).toMatchObject({ code: 'NO_SUCH_JOB' })
    }
  })
})

describe('whole characters of a piece', () => {
  it('stops before a character that the piece cuts in half', () => {
    const bytes = new TextEncoder().encode('aö€😀')
    // a (1) ö (2) € (3) 😀 (4): 10 bytes in all.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((length) => wholeCharacters(bytes, length))).toEqual([1, 1, 3, 3, 3, 6, 6, 6, 6, 10])
  })
})
