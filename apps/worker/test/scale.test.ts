/**
 * The scale test (v1.19 ticket 01, ec-2lts, ec-o5pz, ec-olsc): a year of a busy Robot, seeded through the persistence seam, then the
 * chat, a page of it, the Trajectory, search and a Turn after a sleep, each through the interface a person or a Robot uses, with its
 * rows read (counted at the Robot's SQLite, sql-reads.ts) and its time held to a budget. The numbers are printed.
 *
 * Budgets that today's code exceeds are marked it.fails; the ticket that brings each one inside its budget makes it an it.
 */
import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Conversation, Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { countSqlReads, stopCountingSqlReads, type SqlRead } from './sql-reads.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const DAY = 86_400_000

/** About 150 000 events in 400 spans: a span is what lies between two compactions, 19 Turns of 19 events each and its checkpoint. */
const SPANS = 400
const TURNS_PER_SPAN = 19

/**
 * Opening the chat and loading one page of it: a page is about twenty items, and a few hundred rows is twenty items with what they
 * were folded from. Never the history (ec-yxru). 500 ms is the spec's time in the test environment.
 */
const CHAT_ROWS = 200
const CHAT_MS = 500
/**
 * Waking a Turn after a sleep: it reads its live span, a context budget long (here about 380 events), a small number of times
 * (the resume, the Turn's own events, the views it reports), never the year (ec-7s3l). A Turn on the scripted model takes well under a second.
 */
const TURN_ROWS = 5_000
const TURN_MS = 3_000
/** A Trajectory page shows one span: at most a span's events, read once (ec-elhb). */
const TRAJECTORY_ROWS = 1_000
const TRAJECTORY_MS = 1_000
/** Search over the whole year answers within the spec's time (ec-enqy). */
const SEARCH_MS = 500

const SESSION_TABLES = /session_event|session_log|chat_item|chat_search/

interface Measured<T> { readonly value: T; readonly ms: number; readonly sessionRows: number; readonly rows: number; readonly reads: readonly SqlRead[] }

async function measured<T>(work: () => Promise<T>): Promise<Measured<T>> {
  countSqlReads()
  const started = performance.now()
  try {
    const value = await work()
    const ms = Math.round(performance.now() - started)
    const reads = stopCountingSqlReads()
    const sessionRows = reads.filter((read) => SESSION_TABLES.test(read.query)).reduce((sum, read) => sum + read.cursor.rowsRead, 0)
    return { value, ms, sessionRows, rows: reads.reduce((sum, read) => sum + read.cursor.rowsRead, 0), reads }
  } finally {
    stopCountingSqlReads()
  }
}

const numbers: string[] = []
const report = (name: string, run: Measured<unknown>, extra = '') => {
  numbers.push(`${name.padEnd(24)} ${String(run.ms).padStart(7)} ms ${String(run.sessionRows).padStart(9)} session rows ${String(run.rows).padStart(9)} rows${extra === '' ? '' : `  ${extra}`}`)
  // Where the rows went: the statements that read most, summed by their text.
  const by = new Map<string, { rows: number; runs: number }>()
  for (const read of run.reads) {
    const key = read.query.replace(/\s+/g, ' ').slice(0, 110)
    const entry = by.get(key) ?? { rows: 0, runs: 0 }
    by.set(key, { rows: entry.rows + read.cursor.rowsRead, runs: entry.runs + 1 })
  }
  for (const [query, entry] of [...by.entries()].sort((a, b) => b[1].rows - a[1].rows).slice(0, 3)) numbers.push(`    ${String(entry.rows).padStart(8)} rows in ${String(entry.runs).padStart(4)} runs: ${query}`)
}

let id = ''

beforeAll(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  const me = (await api<Me>(ANNA, '/api/me')).body
  scripts.set('*', [{ text: 'Hello.' }])
  id = (await api<{ id: string }>(ANNA, '/api/robots', { body: {} })).body.id
  await settle(id)
  await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(id).activateForTest()
  scripts.set(id, [{ say: 'Ready.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'hello' } })
  await settle(id)
  const now = Date.now()
  const seeded = await testRobot(id).seedYearForTest({ spans: SPANS, turnsPerSpan: TURNS_PER_SPAN, from: now - 365 * DAY, to: now - DAY, owner: { memberId: me.id, name: me.name }, early: 'zeppelin', late: 'quokka' })
  numbers.push(`seeded                   ${seeded.ms} ms: ${seeded.events} events, ${(seeded.bytes / 1e6).toFixed(1)} MB, ${SPANS} spans, ${seeded.chapters} chapters`)
  // The tidy passes of the year: the chapters outside the window are in R2 (ticket 06).
  const tidied = Date.now()
  let cold = 0
  for (let moved = -1; moved !== 0;) cold += moved = await testRobot(id).tidyChaptersForTest(Date.now(), 50)
  numbers.push(`cold                     ${Date.now() - tidied} ms: ${cold} chapters to R2, ${await testRobot(id).storedEventsForTest()} events left in the Durable Object`)
  // A year of daily notes, indexed (v1.20 ticket 03): the early and the late word in one note each.
  const noted = Date.now()
  for (let day = 0; day < 365; day += 1) {
    const date = new Date(now - (365 - day) * DAY).toISOString().slice(0, 10)
    const word = day === 0 ? ' A zeppelin flew over.' : day === 364 ? ' A quokka smiled.' : ''
    await env.FILES.put(`robots/${id}/memory/${date}.md`, `# ${date}\n\n- Anna called about the flat on day ${day}.${word}\n\n- The invoices of day ${day} are filed.\n`)
  }
  await testRobot(id).catchUpMemoryForTest()
  numbers.push(`notes                    ${Date.now() - noted} ms: 365 daily notes written and indexed`)
  // The Robot sleeps: its memory is gone, the year is in its storage.
  await testRobot(id).restartForTest().catch(() => undefined)
}, 600_000)

afterAll(() => {
  console.log(`\nscale test (v1.19, v1.20):\n${numbers.join('\n')}\n`)
})

describe('a year of a busy Robot (ec-2lts, ec-o5pz)', () => {
  let before: string | null | undefined
  it('opens the chat reading a bounded number of rows (ec-yxru)', async () => {
    const run = await measured(() => api<Conversation>(ANNA, `/api/robots/${id}/conversation`))
    report('chat open', run, run.value.status === 200 ? `${run.value.body.items.length} items` : `status ${run.value.status}: ${JSON.stringify(run.value.body).slice(0, 200)}`)
    expect(run.value.status).toBe(200)
    before = run.value.body.before
    expect(before).toEqual(expect.any(String))
    expect(run.sessionRows).toBeLessThanOrEqual(CHAT_ROWS)
    expect(run.ms).toBeLessThan(CHAT_MS)
  }, 300_000)

  it('loads an older page of the chat by its cursor reading a bounded number of rows (ec-n0uh)', async () => {
    const run = await measured(() => api<Conversation>(ANNA, `/api/robots/${id}/conversation?before=${encodeURIComponent(before!)}`))
    report('chat page 2', run, `${run.value.body.items.length} items`)
    expect(run.value.body.items.length).toBeGreaterThan(0)
    expect(run.sessionRows).toBeLessThanOrEqual(CHAT_ROWS)
    expect(run.ms).toBeLessThan(CHAT_MS)
    // The page another Robot reads (robot_conversation) is as bounded.
    const deputy = await measured(() => env.ROBOT.getByName(id).conversationPage(2))
    report('deputy page 2', deputy, `${deputy.value.items.length} items`)
    expect(deputy.sessionRows).toBeLessThanOrEqual(CHAT_ROWS)
  }, 300_000)

  it('opens the Trajectory reading one span, the live one or an old one (ec-elhb)', async () => {
    for (const [name, query] of [['trajectory', ''], ['trajectory chapter 200 (cold)', '?chapter=200'], ['trajectory chapter 380', '?chapter=380']] as const) {
      const run = await measured(() => api<{ events: unknown[]; chapters: unknown[] }>(ANNA, `/api/robots/${id}/trajectory${query}`))
      report(name, run, run.value.status === 200 ? `${run.value.body.events.length} events, ${run.value.body.chapters.length} chapters listed` : `status ${run.value.status}`)
      expect(run.value.status).toBe(200)
      expect(run.value.body.chapters).toHaveLength(SPANS)
      expect(run.sessionRows).toBeLessThanOrEqual(TRAJECTORY_ROWS)
      expect(run.ms).toBeLessThan(TRAJECTORY_MS)
    }
  }, 300_000)

  it('pages the raw events of the Trajectory reading one page', async () => {
    const run = await measured(() => api<{ events: unknown[] }>(ANNA, `/api/robots/${id}/events?limit=400&chapter=200`))
    report('trajectory events page', run, `${run.value.body.events.length} events`)
    expect(run.sessionRows).toBeLessThanOrEqual(TRAJECTORY_ROWS)
    expect(run.ms).toBeLessThan(TRAJECTORY_MS)
  }, 300_000)

  it('finds an early and a late word within the time (ec-enqy)', async () => {
    const early = await measured(() => env.ROBOT.getByName(id).searchConversation('zeppelin'))
    report('search early', early, `${early.value.items.length} hits`)
    const late = await measured(() => env.ROBOT.getByName(id).searchConversation('quokka'))
    report('search late', late, `${late.value.items.length} hits`)
    expect(early.value.items).toHaveLength(1)
    expect(late.value.items).toHaveLength(1)
    expect(early.ms).toBeLessThan(SEARCH_MS)
    expect(late.ms).toBeLessThan(SEARCH_MS)
  }, 300_000)

  it('finds a word in a year of daily notes within the time (dm-hmet)', async () => {
    for (const [name, word] of [['memory search early', 'zeppelin'], ['memory search late', 'quokka']] as const) {
      const run = await measured(() => env.ROBOT.getByName(id).memorySearch(word))
      report(name, run, `${run.value.length} matches`)
      expect(run.value).toHaveLength(1)
      expect(run.value[0]!.path).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/)
      expect(run.ms).toBeLessThan(SEARCH_MS)
    }
  }, 300_000)

  it('records where the agent resumes from after a sleep', async () => {
    await testRobot(id).restartForTest().catch(() => undefined)
    const run = await measured(() => testRobot(id).resumeForTest())
    const logReads = run.reads.filter((read) => /FROM session_event WHERE session_id = \? AND seq >= \?/.test(read.query))
    const from = logReads.map((read) => `from seq ${String(read.bindings[1])}: ${read.cursor.rowsRead} rows`).join('; ')
    report('agent resume', run, from)
    expect(logReads.length).toBeGreaterThan(0)
  }, 300_000)

  it('wakes a Turn after a sleep reading only its live span (ec-7s3l)', async () => {
    await testRobot(id).restartForTest().catch(() => undefined)
    scripts.set(id, [{ say: 'Noted.' }])
    const run = await measured(async () => {
      await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'one more thing' } })
      await settle(id)
    })
    report('turn wake', run)
    expect(JSON.stringify(requests.get(id)!.at(-1)!.messages)).toContain('one more thing')
    expect(run.sessionRows).toBeLessThanOrEqual(TURN_ROWS)
    expect(run.ms).toBeLessThan(TURN_MS)
  }, 600_000)
})