/**
 * File tools on a Host (v1.21 ticket 03): read reports size, line endings and hash (cw-vwo1); a write names the hash its agent read, so a
 * file another Robot changed meanwhile is refused (cw-jko0); edit works in the file's line endings (cw-71bx); a write cut off by a lost
 * link is sent again with its id and not done twice (cw-6b3r); a write over the frame limit is refused with the way to copy (cw-1ov7).
 * Driven through the edge API with the scripted model and the fake Host app.
 */
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WRITE_FRAME_MAX_BYTES } from '@mr-robot/host-protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, cut, fakeHost, hostDisk, hostFileCalls, hostWrites } from './fake-host.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostDisk.clear()
  hostFileCalls.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotOn(host: { hostId: string }, name = 'Coder'): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: { name } })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow' }, hosts: { [`${host.hostId}:files`]: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').slice(-list.length).map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}
const bytes = (text: string) => new TextEncoder().encode(text)
const text = (path: string) => new TextDecoder().decode(hostDisk.get(path))
const FILE = '/home/anna/src/app.ts'

describe('read on a Host (cw-vwo1)', () => {
  it('reports the size, the line endings and the content hash above the window', async () => {
    const desk = await fakeHost('Desk')
    hostDisk.set(FILE, bytes('one\r\ntwo\r\n'))
    const id = await robotOn(desk)
    const [read] = await calls(id, [{ name: 'read', args: { on: 'Desk', file_path: FILE } }])
    expect(read).toContain('<size>10 bytes</size>')
    expect(read).toContain('<line-ending>crlf</line-ending>')
    expect(read).toMatch(/<hash>sha256:[0-9a-f]{64}<\/hash>/)
    expect(read).toContain('1: one\n2: two')
  })
})

describe('two Robots on one file (cw-jko0)', () => {
  it('refuses an edit of a file another Robot changed since it was read, and takes it after a new read', async () => {
    const desk = await fakeHost('Desk')
    hostDisk.set(FILE, bytes('let a = 1\n'))
    const first = await robotOn(desk, 'First')
    const second = await robotOn(desk, 'Second')
    await calls(first, [{ name: 'read', args: { on: 'Desk', file_path: FILE } }])
    await calls(second, [{ name: 'read', args: { on: 'Desk', file_path: FILE } }, { name: 'edit', args: { on: 'Desk', file_path: FILE, old_string: 'let a = 1', new_string: 'let a = 2' } }])
    expect(text(FILE)).toBe('let a = 2\n')
    const [stale] = await calls(first, [{ name: 'write', args: { on: 'Desk', file_path: FILE, content: 'let a = 3\n' } }])
    expect(stale).toContain('changed since you read it')
    expect(stale).toContain('STALE_CONTENT')
    expect(text(FILE)).toBe('let a = 2\n')
    const [, again] = await calls(first, [{ name: 'read', args: { on: 'Desk', file_path: FILE } }, { name: 'edit', args: { on: 'Desk', file_path: FILE, old_string: 'let a = 2', new_string: 'let a = 3' } }])
    expect(JSON.parse(again!)).toMatchObject({ edited: FILE })
    expect(text(FILE)).toBe('let a = 3\n')
  })
})

describe('edit in the file\'s line endings (cw-71bx)', () => {
  it('matches lines as read shows them in a CRLF file and writes CRLF', async () => {
    const desk = await fakeHost('Desk')
    hostDisk.set(FILE, bytes('alpha\r\nbeta\r\ngamma\r\n'))
    const id = await robotOn(desk)
    const [, edited] = await calls(id, [
      { name: 'read', args: { on: 'Desk', file_path: FILE } },
      { name: 'edit', args: { on: 'Desk', file_path: FILE, old_string: 'alpha\nbeta', new_string: 'one\ntwo\nthree' } },
    ])
    expect(JSON.parse(edited!)).toMatchObject({ edited: FILE })
    expect(text(FILE)).toBe('one\r\ntwo\r\nthree\r\ngamma\r\n')
  })
})

describe('a write cut off by a lost link (cw-6b3r)', () => {
  it('is sent again with its id when the app is back, and the app answers without writing twice', async () => {
    const desk = await fakeHost('Desk')
    const id = await robotOn(desk)
    cut.nextWrite = true
    const [written] = await calls(id, [{ name: 'write', args: { on: 'Desk', file_path: FILE, content: 'once' } }])
    expect(JSON.parse(written!)).toMatchObject({ written: FILE, bytes: 4 })
    expect(hostWrites.map((entry) => entry.wrote)).toEqual([true, false])
    expect(hostWrites[0]!.id).toBe(hostWrites[1]!.id)
    expect(text(FILE)).toBe('once')
  })
})

describe('the write frame limit (cw-1ov7)', () => {
  it('refuses a write over the limit with the advice to copy, and sends nothing to the app', async () => {
    const desk = await fakeHost('Desk')
    const id = await robotOn(desk)
    const [refused] = await calls(id, [{ name: 'write', args: { on: 'Desk', file_path: FILE, content: 'x'.repeat(WRITE_FRAME_MAX_BYTES + 1) } }])
    expect(refused).toContain(`a write carries at most ${WRITE_FRAME_MAX_BYTES} bytes to a computer in one frame`)
    expect(refused).toContain('move it with copy')
    expect(hostFileCalls.filter((call) => call.rpc === 'Write')).toEqual([])
  })
})
