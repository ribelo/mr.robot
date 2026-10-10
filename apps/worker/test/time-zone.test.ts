import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, RobotPanel } from '@mr-robot/protocol'
import { localDate } from '../src/robot/schedule.ts'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const NEW_YORK = 'America/New_York'
const TOKYO = 'Asia/Tokyo'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

const me = async (zone?: string) => (await api<Me>(ANNA, '/api/me', zone === undefined ? {} : { headers: { 'X-Time-Zone': zone } })).body

async function activeRobot(tools: string[] = []): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools, skills: [], recipients: [], secrets: [], hosts: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(id: string, text: string, script: Parameters<typeof scripts.set>[1] = [{ text: 'Ok.' }]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const lastUser = (id: string) => JSON.stringify((requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction').at(-1)!.messages.filter((message) => message.role === 'user').at(-1))
const allUser = (id: string) => JSON.stringify((requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction').at(-1)!.messages.filter((message) => message.role === 'user'))
const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body

describe('the profile zone comes from the app (v1.11 ticket 08)', () => {
  it('a new Member starts in UTC and the X-Time-Zone header sets the zone (sk-vpxv)', async () => {
    expect(await me()).toMatchObject({ timeZone: 'UTC', timeZonePinned: false, detectedTimeZone: null })
    expect(await me(NEW_YORK)).toMatchObject({ timeZone: NEW_YORK, timeZonePinned: false, detectedTimeZone: NEW_YORK })
    expect(await me(TOKYO)).toMatchObject({ timeZone: TOKYO, detectedTimeZone: TOKYO })
    // The zone is stored, not just echoed.
    expect(await me()).toMatchObject({ timeZone: TOKYO })
  })

  it('ignores a header that is not an IANA zone', async () => {
    await me(NEW_YORK)
    for (const bad of ['', 'Mars/Olympus', 'banana', '+02:00', 'Europe/']) expect(await me(bad)).toMatchObject({ timeZone: NEW_YORK, detectedTimeZone: NEW_YORK })
  })

  it('a zone typed by hand pins; the app no longer overwrites it; "Use the app\'s zone" unpins (sk-y38c)', async () => {
    await me(NEW_YORK)
    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { timeZone: TOKYO } })).status).toBe(200)
    expect(await me(NEW_YORK)).toMatchObject({ timeZone: TOKYO, timeZonePinned: true, detectedTimeZone: NEW_YORK })
    // Saving other fields does not touch the pin.
    await api(ANNA, '/api/me', { method: 'PATCH', body: { name: 'Anna B' } })
    expect(await me(NEW_YORK)).toMatchObject({ timeZone: TOKYO, timeZonePinned: true })
    await api(ANNA, '/api/me', { method: 'PATCH', body: { useDetectedTimeZone: true } })
    expect(await me()).toMatchObject({ timeZone: NEW_YORK, timeZonePinned: false })
    // Following the app again.
    expect(await me('Europe/Berlin')).toMatchObject({ timeZone: 'Europe/Berlin', timeZonePinned: false })
  })

  it('refuses a typed zone that is not a zone', async () => {
    const refused = await api<{ error: string }>(ANNA, '/api/me', { method: 'PATCH', body: { timeZone: 'Mars/Olympus' } })
    expect(refused.status).toBe(400)
    expect(await me()).toMatchObject({ timeZone: 'UTC', timeZonePinned: false })
  })
})

describe('Robots follow the profile zone (sk-0vfm, sk-u3bv)', () => {
  it('moves wall-clock Routines to the new zone, leaves a Routine with its own zone, and tells each Robot once', async () => {
    const id = await activeRobot(['routines'])
    await turn(id, 'set up routines', [
      { calls: [
        { name: 'routine_set', args: { title: 'Digest', prompt: 'Send the digest.', daily: { time: '09:00:00', time_zone: 'UTC' } } },
        { name: 'routine_set', args: { title: 'Tokyo close', prompt: 'Close the books.', daily: { time: '18:30:00', time_zone: TOKYO } } },
      ] },
      { text: 'Done.' },
    ])
    const before = (await panel(id)).routines
    expect(before.map((routine) => routine.timeZone).sort()).toEqual([TOKYO, 'UTC'])
    const tokyoRun = before.find((routine) => routine.name === 'Tokyo close')!.nextRun

    // Mr. Robot has already seen its baseline, so the change reaches it as a note.
    const mr = (await robots(ANNA)).find((robot) => robot.kind === 'mr-robot')!
    await turn(mr.id, 'hello')

    await me(NEW_YORK)

    const after = (await panel(id)).routines
    const digest = after.find((routine) => routine.name === 'Digest')!
    expect(digest.timeZone).toBe(NEW_YORK)
    expect(localDate(digest.nextRun!, NEW_YORK)).toMatchObject({ hour: 9, minute: 0 })
    expect(digest.nextRun!).toBeGreaterThan(Date.now())
    const tokyo = after.find((routine) => routine.name === 'Tokyo close')!
    expect(tokyo).toMatchObject({ timeZone: TOKYO, nextRun: tokyoRun })
    expect(await testRobot(id).alarmForTest()).toBe(Math.min(digest.nextRun!, tokyo.nextRun!))

    // The next Turn hears it once, on every Robot of the owner (Mr. Robot too).
    await turn(id, 'what now?')
    expect(lastUser(id)).toContain(`time zone changed to ${NEW_YORK}`)
    await turn(id, 'and again?')
    expect(lastUser(id)).not.toContain('time zone changed')
    await turn(mr.id, 'hello again')
    expect(lastUser(mr.id)).toContain(`time zone changed to ${NEW_YORK}`)

    // The same zone again is not a change.
    await me(NEW_YORK)
    await turn(id, 'still?')
    expect(lastUser(id)).not.toContain('time zone changed')
  })

  it('a pinned zone is what Robots follow, and unpinning moves them to the app\'s zone', async () => {
    const id = await activeRobot(['routines'])
    await turn(id, 'set up', [{ calls: [{ name: 'routine_set', args: { title: 'Digest', prompt: 'Send the digest.', daily: { time: '09:00:00', time_zone: 'UTC' } } }] }, { text: 'Done.' }])
    await me(NEW_YORK)
    await api(ANNA, '/api/me', { method: 'PATCH', body: { timeZone: TOKYO } })
    expect((await panel(id)).routines[0]).toMatchObject({ timeZone: TOKYO })
    await me('Europe/Berlin')
    expect((await panel(id)).routines[0]).toMatchObject({ timeZone: TOKYO })
    await api(ANNA, '/api/me', { method: 'PATCH', body: { useDetectedTimeZone: true } })
    const digest = (await panel(id)).routines[0]!
    expect(digest).toMatchObject({ timeZone: 'Europe/Berlin' })
    expect(localDate(digest.nextRun!, 'Europe/Berlin')).toMatchObject({ hour: 9, minute: 0 })
  })

  it('daily notes follow the new zone at the next baseline', async () => {
    const day = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now())
    // 25 hours apart: today's note in one zone is never today's or yesterday's in the other.
    const behind = 'Pacific/Pago_Pago'
    const ahead = 'Pacific/Kiritimati'
    await me(behind)
    const id = await activeRobot()
    await api(ANNA, `/api/robots/${id}/file?path=memory/${day(behind)}.md`, { method: 'PUT', body: { content: 'Note written behind the date line.' } })
    await api(ANNA, `/api/robots/${id}/file?path=memory/${day(ahead)}.md`, { method: 'PUT', body: { content: 'Note written ahead of the date line.' } })
    await turn(id, 'hi')
    expect(allUser(id)).toContain('Note written behind the date line.')
    expect(allUser(id)).not.toContain('Note written ahead of the date line.')

    await me(ahead)
    await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'New robot' } })
    await turn(id, 'hi again')
    expect(allUser(id)).toContain('Note written ahead of the date line.')
  })

  it('a Robot created after the zone is known keeps its Routines in the profile zone through later moves', async () => {
    await me(NEW_YORK)
    const id = await activeRobot(['routines'])
    await turn(id, 'set up', [{ calls: [{ name: 'routine_set', args: { title: 'Digest', prompt: 'Send the digest.', daily: { time: '09:00:00', time_zone: NEW_YORK } } }] }, { text: 'Done.' }])
    expect((await panel(id)).routines[0]).toMatchObject({ timeZone: NEW_YORK })
    await me(TOKYO)
    expect((await panel(id)).routines[0]).toMatchObject({ timeZone: TOKYO })
  })
})
