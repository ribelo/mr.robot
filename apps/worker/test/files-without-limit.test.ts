/**
 * Files without limit (v1.16 ticket 06): the Box's token door and ws, and copy between the Workspace, the Box and Hosts over presigned R2 URLs.
 * Driven through the edge API with the scripted model, the stub Box (which runs the real ws program), the fake Host app (which runs the real
 * copy engine) and R2 played by the FILES binding behind the URLs the Worker's real signer made (fake-r2.ts).
 */
import { env, listDurableObjectIds, reset, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostCopies, hostDisk } from './fake-host.ts'
import { r2Faults, r2Log } from './fake-r2.ts'
import { boxDisks, boxLog, boxScripts, wsTaps, type BoxNetwork } from './stub-box.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const PRESIGN = 'https://mr-robot.test/api/files/presign'
const MIB = 1024 * 1024

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  boxLog.clear()
  boxDisks.clear()
  boxScripts.clear()
  wsTaps.clear()
  hostDisk.clear()
  hostCopies.length = 0
  r2Log.length = 0
  r2Faults.next = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotWith(grants: { tools?: Record<string, string>; hosts?: Record<string, string> }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget: 32_000, grants: { tools: grants.tools ?? {}, hosts: grants.hosts ?? {} } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown> }
/** The calls go one after the other, one step each; the results come back in the same order. */
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join('')).slice(-list.length)
}
const json = (text: string | undefined) => JSON.parse(text!) as Record<string, any>

/** A pattern that shows a wrong byte, a wrong order or a lost part. */
const binary = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + (index >> 8)) & 255)
const workspaceBytes = async (id: string, path: string) => {
  const object = await env.FILES.get(`robots/${id}/${path}`)
  return object === null ? null : new Uint8Array(await object.arrayBuffer())
}
/** Bytes equal, said as a boolean: a failed toEqual on megabytes would print them all. */
const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array): boolean => a !== null && a !== undefined && a.length === b.length && a.every((byte, index) => byte === b[index])
const boxBytes = (id: string, path: string) => boxDisks.get(id)?.get(path)?.bytes

/** The Box's token, as written into its container at boot. */
const tokenOf = (id: string) => new TextDecoder().decode(boxBytes(id, '/run/mr-robot/token'))

async function presign(token: string | undefined, body: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const response = await SELF.fetch(PRESIGN, { method: 'POST', headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

describe('the Box token and the presign door (ob-qshq, ob-o6aw)', () => {
  it('mints links for one key under the Robot\'s prefix, and refuses what is outside it', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    const token = tokenOf(id)
    expect(token.startsWith(`${id}.`)).toBe(true)
    await env.FILES.put(`robots/${id}/inbox/a.bin`, binary(1000))

    const link = await presign(token, { op: 'get', path: 'inbox/a.bin' })
    expect(link.status).toBe(200)
    expect(link.body['size']).toBe(1000)
    const url = new URL(link.body['url'])
    expect(url.origin + url.pathname).toBe(`https://test-account.r2.cloudflarestorage.com/files/robots/${id}/inbox/a.bin`)
    // A link for the Box lives fifteen minutes (S4): ws asks again for each part.
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBe(15 * 60)
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    // A path is a key under the prefix or it is refused: nothing outside it is ever signed.
    for (const path of ['../r-other/secret', '/etc/passwd', 'a/../../b']) expect((await presign(token, { op: 'get', path })).status).toBe(400)
    const inside = await presign(token, { op: 'part', path: 'robots/r-other/x', number: 1 })
    expect(new URL(inside.body['url']).pathname).toBe(`/files/robots/${id}/robots/r-other/x`)
    expect((await presign(token, { op: 'part', path: 'x', number: 1.5 })).status).toBe(400)
    expect((await presign(token, { op: 'part', path: 'x', number: 0 })).status).toBe(400)
    expect((await presign(token, { op: 'part', path: 'x', number: 2 })).status).toBe(400)
    // The owner's files and the docs are not objects a Box may write.
    expect((await presign(token, { op: 'put', path: 'USER.md', size: 5 })).status).toBe(400)
    expect((await presign(token, { op: 'put', path: 'docs/robots.md', size: 5 })).status).toBe(400)
    expect((await presign(token, { op: 'get', path: 'no/such/file' })).status).toBe(404)
    expect((await presign(token, { op: 'rm', path: 'no/such/file' })).status).toBe(404)
    expect((await presign(token, { op: 'nonsense', path: 'a' })).status).toBe(400)
    // A file that needs parts is a multipart upload: one URL per part, the last one short.
    const plan = await presign(token, { op: 'put', path: 'big.bin', size: 12 * MIB })
    expect(plan.body['uploadId']).toEqual(expect.any(String))
    expect(plan.body['parts'].map((part: { number: number; offset: number; length: number }) => [part.number, part.offset, part.length])).toEqual([[1, 0, 5 * MIB], [2, 5 * MIB, 5 * MIB], [3, 10 * MIB, 2 * MIB]])
    expect((await presign(token, { op: 'abort', path: 'big.bin', uploadId: plan.body['uploadId'] })).status).toBe(200)
  })

  it('refuses no token, a made-up token, another Box\'s token and a token after the Box stopped', async () => {
    const one = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    const two = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(one, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    await calls(two, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    await env.FILES.put(`robots/${one}/private.txt`, 'mine')
    expect((await presign(undefined, { op: 'ls', path: '' })).status).toBe(401)
    expect((await presign('nonsense', { op: 'ls', path: '' })).status).toBe(401)
    expect((await presign(`${one}.${'0'.repeat(64)}`, { op: 'ls', path: '' })).status).toBe(401)
    // The second Robot's secret under the first Robot's name is no key to the first Robot's files.
    const secretOfTwo = tokenOf(two).slice(two.length + 1)
    expect((await presign(`${one}.${secretOfTwo}`, { op: 'get', path: 'private.txt' })).status).toBe(401)
    // The second Robot's own token reaches the second Robot's Workspace only.
    expect((await presign(tokenOf(two), { op: 'get', path: 'private.txt' })).status).toBe(404)
    const listed = async (robot: string) => (await presign(tokenOf(robot), { op: 'ls', path: '' })).body['files'].map((file: { path: string }) => file.path)
    expect(await listed(two)).not.toContain('private.txt')
    expect(await listed(one)).toContain('private.txt')

    const token = tokenOf(one)
    expect((await presign(token, { op: 'get', path: 'private.txt' })).status).toBe(200)
    expect((await api(ANNA, `/api/robots/${one}/box/stop`, { method: 'POST' })).status).toBe(200)
    expect((await presign(token, { op: 'get', path: 'private.txt' })).status).toBe(401)
    // The next boot makes a new token; the old one stays dead.
    await calls(one, [{ name: 'run', args: { on: 'box', command: 'echo again' } }])
    expect(tokenOf(one)).not.toBe(token)
    expect((await presign(token, { op: 'get', path: 'private.txt' })).status).toBe(401)
    expect((await presign(tokenOf(one), { op: 'get', path: 'private.txt' })).status).toBe(200)
  })

  it('refuses a forged token at the edge, and no Robot is made for it', async () => {
    const one = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(one, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    const hex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const stranger = `r-${crypto.randomUUID()}`
    const before = (await listDurableObjectIds(env.ROBOT)).length
    const forged = [
      // A Robot that does not exist, in the shape of a real token and of the earlier one.
      `${stranger}.${hex(32)}.${hex(32)}`,
      `${stranger}.${hex(32)}`,
      // A name that is no Robot id at all.
      `x-${hex(8)}.${hex(32)}.${hex(32)}`,
      // A real Robot with a signature that is not the Worker's.
      `${one}.${hex(32)}.${hex(32)}`,
      `${tokenOf(one).slice(0, -64)}${hex(32)}`,
    ]
    for (const token of forged) expect((await presign(token, { op: 'ls', path: '' })).status).toBe(401)
    expect((await listDurableObjectIds(env.ROBOT)).length).toBe(before)
    expect((await listDurableObjectIds(env.ROBOT)).map((id) => id.toString())).not.toContain(env.ROBOT.idFromName(stranger).toString())
    expect((await presign(tokenOf(one), { op: 'ls', path: '' })).status).toBe(200)
  })
})

describe('ws in the Box (ob-fgyk, ob-63nt)', () => {
  it('lists, puts, gets and removes Workspace files of any size from a command; a failed part is tried again', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    const big = binary(12 * MIB + 321)
    const results = await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    expect(results).toHaveLength(1)
    boxDisks.get(id)!.set('/workspace/data/big.bin', { bytes: big, mtime: 1 })
    r2Faults.next = 2
    const [put, ls, get, rm, lsAfter, missing, usage] = await calls(id, [
      { name: 'run', args: { on: 'box', command: 'ws put data/big.bin out/big.bin' } },
      { name: 'run', args: { on: 'box', command: 'ws ls out' } },
      { name: 'run', args: { on: 'box', command: 'ws get out/big.bin fetched/copy.bin' } },
      { name: 'run', args: { on: 'box', command: 'ws rm out/big.bin' } },
      { name: 'run', args: { on: 'box', command: 'ws ls' } },
      { name: 'run', args: { on: 'box', command: 'ws get out/big.bin' } },
      { name: 'run', args: { on: 'box', command: 'ws' } },
    ])
    expect(json(put)).toMatchObject({ exitCode: 0, stdout: `put data/big.bin -> out/big.bin (${big.length} bytes)\n` })
    // Three parts of 5 MiB, 5 MiB and the rest; the two refused attempts were tried again.
    expect(r2Log.filter((entry) => entry.method === 'PUT').map((entry) => entry.part)).toEqual([1, 1, 1, 2, 3])
    expect(json(ls).stdout).toBe(`${big.length}\tout/big.bin\n`)
    expect(json(get)).toMatchObject({ exitCode: 0, stdout: `got out/big.bin -> fetched/copy.bin (${big.length} bytes)\n` })
    expect(sameBytes(boxBytes(id, '/workspace/fetched/copy.bin'), big)).toBe(true)
    expect(json(rm)).toMatchObject({ exitCode: 0, stdout: 'removed out/big.bin\n' })
    expect(await workspaceBytes(id, 'out/big.bin')).toBeNull()
    expect(json(lsAfter).stdout).not.toContain('out/big.bin')
    expect(json(missing)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('no file "out/big.bin" in your Workspace') })
    expect(json(usage).stdout).toBe('')
  })

  it('uploads what ws put sent in the parts it was told, and reads in ranges of the part size', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    boxDisks.get(id)!.set('/workspace/v.bin', { bytes: binary(11 * MIB), mtime: 1 })
    r2Log.length = 0
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'ws put v.bin kept/v.bin' } }, { name: 'run', args: { on: 'box', command: 'ws get kept/v.bin w.bin' } }])
    expect(r2Log.filter((entry) => entry.method === 'PUT').map((entry) => entry.part)).toEqual([1, 2, 3])
    // Every link ws was given lives fifteen minutes.
    expect(r2Log.every((entry) => entry.expires === 15 * 60)).toBe(true)
    expect(r2Log.filter((entry) => entry.method === 'GET').map((entry) => entry.range)).toEqual([`bytes=0-${5 * MIB - 1}`, `bytes=${5 * MIB}-${10 * MIB - 1}`, `bytes=${10 * MIB}-${11 * MIB - 1}`])
    expect(sameBytes(await workspaceBytes(id, 'kept/v.bin'), binary(11 * MIB))).toBe(true)
    expect(sameBytes(boxBytes(id, '/workspace/w.bin'), binary(11 * MIB))).toBe(true)
  })
})

describe('copy over presigned links (ob-d3rt, ob-qshq, ob-fgyk, ob-qr7v, ob-7hp3)', () => {
  it('moves a file larger than a part between a Host and the Workspace, each way, and says its size and time', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    const bytes = binary(12 * MIB + 7)
    hostDisk.set('/home/anna/video.bin', bytes)
    const [up, down] = await calls(id, [
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/video.bin' }, to: { on: 'workspace', path: 'inbox/video.bin' } } },
      { name: 'copy', args: { from: { on: 'workspace', path: 'inbox/video.bin' }, to: { on: 'Desk', path: '/home/anna/back/video.bin' } } },
    ])
    expect(json(up)).toEqual({ from: { on: 'Desk', path: '/home/anna/video.bin' }, to: { on: 'workspace', path: '/workspace/inbox/video.bin' }, bytes: bytes.length, ms: expect.any(Number), took: expect.stringMatching(/^12\.0 MB in /) })
    expect(sameBytes(await workspaceBytes(id, 'inbox/video.bin'), bytes)).toBe(true)
    expect(json(down)).toMatchObject({ to: { on: 'Desk', path: '/home/anna/back/video.bin' }, bytes: bytes.length })
    expect(sameBytes(hostDisk.get('/home/anna/back/video.bin'), bytes)).toBe(true)
    // The Host app moved the bytes one part per call, each with its own deadline and on a link minted just before it (deep review P12):
    // three parts up, three ranges down.
    expect(hostCopies).toEqual([
      ...[1, 2, 3].map(() => ({ rpc: 'Upload', path: '/home/anna/video.bin', size: bytes.length, parts: 1 })),
      ...[1, 2, 3].map(() => ({ rpc: 'Download', path: '/home/anna/back/video.bin', size: bytes.length, parts: 1 })),
    ])
    expect(r2Log.every((entry) => entry.key === `robots/${id}/inbox/video.bin`)).toBe(true)
    expect(r2Log).toHaveLength(6)
    // A link for a Host lives an hour at most (S4).
    expect(r2Log.every((entry) => entry.expires <= 3600)).toBe(true)
  })

  it('tries a refused part again, and gives up with the reason when R2 keeps refusing', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    hostDisk.set('/home/anna/a.bin', binary(1000))
    r2Faults.next = 2
    const [retried] = await calls(id, [{ name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/a.bin' }, to: { on: 'workspace', path: 'a.bin' } } }])
    expect(json(retried)).toMatchObject({ bytes: 1000 })
    expect(sameBytes(await workspaceBytes(id, 'a.bin'), binary(1000))).toBe(true)
    r2Faults.next = 100
    const [refused] = await calls(id, [{ name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/a.bin' }, to: { on: 'workspace', path: 'b.bin' } } }])
    expect(refused).toContain('failed after 4 attempts')
    expect(await workspaceBytes(id, 'b.bin')).toBeNull()
  })

  it('stages a copy between two Hosts, and between the Box and a Host, under tmp/ and deletes the staged file', async () => {
    const desk = await fakeHost('Desk')
    const laptop = await fakeHost('Laptop')
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow', [`${laptop.hostId}:files`]: 'allow' } })
    const bytes = binary(7 * MIB)
    hostDisk.set('/home/anna/clip.bin', bytes)
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    boxDisks.get(id)!.set('/workspace/scratch/clip.bin', { bytes, mtime: 1 })
    r2Log.length = 0
    const [hostToHost, boxToHost, hostToBox] = await calls(id, [
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/clip.bin' }, to: { on: 'Laptop', path: '/home/ben/clip.bin' } } },
      { name: 'copy', args: { from: { on: 'box', path: 'scratch/clip.bin' }, to: { on: 'Laptop', path: '/home/ben/from-box.bin' } } },
      { name: 'copy', args: { from: { on: 'Laptop', path: '/home/ben/clip.bin' }, to: { on: 'box', path: 'scratch/clip2.bin' } } },
    ])
    expect(json(hostToHost)).toMatchObject({ from: { on: 'Desk', path: '/home/anna/clip.bin' }, to: { on: 'Laptop', path: '/home/ben/clip.bin' }, bytes: bytes.length })
    expect(json(boxToHost)).toMatchObject({ from: { on: 'box', path: '/workspace/scratch/clip.bin' }, to: { on: 'Laptop', path: '/home/ben/from-box.bin' }, bytes: bytes.length })
    expect(json(hostToBox)).toMatchObject({ from: { on: 'Laptop', path: '/home/ben/clip.bin' }, to: { on: 'box', path: '/workspace/scratch/clip2.bin' }, bytes: bytes.length })
    expect(sameBytes(hostDisk.get('/home/ben/clip.bin'), bytes)).toBe(true)
    expect(sameBytes(hostDisk.get('/home/ben/from-box.bin'), bytes)).toBe(true)
    expect(sameBytes(boxBytes(id, '/workspace/scratch/clip2.bin'), bytes)).toBe(true)
    // Everything R2 was asked for was a key under tmp/<id>/ of this Robot, and none of it is left.
    expect(new Set(r2Log.map((entry) => entry.key.replace(/\/tmp\/[0-9a-f-]{36}\//, '/tmp/<id>/')))).toEqual(new Set([`robots/${id}/tmp/<id>/file`]))
    expect((await env.FILES.list({ prefix: `robots/${id}/tmp/` })).objects).toEqual([])
    // Each Host logs the copy it took part in.
    const log = async (host: string) => (await api<Array<{ action: string; detail: string; outcome: string }>>(ANNA, `/api/hosts/${host}/actions`)).body.filter((action) => action.action === 'copy').map((action) => [action.detail, action.outcome])
    expect(await log(desk.hostId)).toEqual([['/home/anna/clip.bin → /home/ben/clip.bin', 'done']])
    expect(await log(laptop.hostId)).toEqual([['/home/ben/clip.bin → scratch/clip2.bin', 'done'], ['scratch/clip.bin → /home/ben/from-box.bin', 'done'], ['/home/anna/clip.bin → /home/ben/clip.bin', 'done']])
  })

  it('deletes the staged file when the second half of a staged copy fails', async () => {
    const desk = await fakeHost('Desk')
    const laptop = await fakeHost('Laptop')
    const id = await robotWith({ tools: { files: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow', [`${laptop.hostId}:files`]: 'allow' } })
    hostDisk.set('/home/anna/clip.bin', binary(3000))
    laptop.socket.close(1000)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const [failed] = await calls(id, [{ name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/clip.bin' }, to: { on: 'Laptop', path: '/home/ben/clip.bin' } } }])
    expect(failed).toContain('Laptop')
    // The first half ran (the file was parked in R2), and nothing is left of it.
    expect(r2Log.some((entry) => entry.method === 'PUT' && entry.key.includes('/tmp/'))).toBe(true)
    expect((await env.FILES.list({ prefix: `robots/${id}/tmp/` })).objects).toEqual([])
  })

  it('copies between the Workspace and the Box through ws without a size limit and without the Worker holding the file', async () => {
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' } })
    const bytes = binary(11 * MIB + 5)
    await env.FILES.put(`robots/${id}/inbox/model.bin`, bytes)
    const [toBox, back] = await calls(id, [
      { name: 'copy', args: { from: { on: 'workspace', path: 'inbox/model.bin' }, to: { on: 'box', path: 'models/model.bin' } } },
      { name: 'copy', args: { from: { on: 'box', path: 'models/model.bin' }, to: { on: 'workspace', path: 'out/model-copy.bin' } } },
    ])
    expect(json(toBox)).toMatchObject({ from: { on: 'workspace', path: '/workspace/inbox/model.bin' }, to: { on: 'box', path: '/workspace/models/model.bin' }, bytes: bytes.length, took: expect.stringMatching(/^11\.0 MB in /) })
    expect(sameBytes(boxBytes(id, '/workspace/models/model.bin'), bytes)).toBe(true)
    expect(json(back)).toMatchObject({ bytes: bytes.length })
    expect(sameBytes(await workspaceBytes(id, 'out/model-copy.bin'), bytes)).toBe(true)
    // ws did it: the Box ran ws commands, and R2 saw ranged reads and part uploads.
    expect(boxLog.get(id)!.filter((entry) => entry.includes(': ws '))).toEqual([expect.stringContaining("ws get 'inbox/model.bin' '/workspace/models/model.bin'"), expect.stringContaining("ws put '/workspace/models/model.bin' 'out/model-copy.bin'")])
    // A failed ws is the copy's failure, with ws's words.
    const [missing] = await calls(id, [{ name: 'copy', args: { from: { on: 'workspace', path: 'inbox/none.bin' }, to: { on: 'box', path: 'x' } } }])
    expect(missing).toContain('no file "inbox/none.bin" in your Workspace')
  })
})

describe('the Box\'s door applies the Workspace rules of the tools (D1)', () => {
  it('refuses a Box whose Robot holds no files grant, and one whose files are at ask, but lets an approved copy through', async () => {
    const none = await robotWith({ tools: { box: 'allow' } })
    await calls(none, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    await env.FILES.put(`robots/${none}/secret.txt`, 'mine')
    const refused = await presign(tokenOf(none), { op: 'get', path: 'secret.txt' })
    expect(refused.status).toBe(403)
    expect(refused.body['error']).toContain('the tool group "files"')
    expect((await presign(tokenOf(none), { op: 'ls', path: '' })).status).toBe(403)
    expect((await presign(tokenOf(none), { op: 'rm', path: 'secret.txt' })).status).toBe(403)
    expect(await workspaceBytes(none, 'secret.txt')).not.toBeNull()
    const [script] = await calls(none, [{ name: 'run', args: { on: 'box', command: 'ws get secret.txt' } }])
    expect(json(script)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining('the tool group "files"') })

    // At ask a script cannot be asked: the door says so and names the grant.
    const asking = await robotWith({ tools: { box: 'allow', files: 'ask' } })
    await calls(asking, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    await env.FILES.put(`robots/${asking}/data.bin`, binary(1000))
    const atAsk = await presign(tokenOf(asking), { op: 'get', path: 'data.bin' })
    expect(atAsk.status).toBe(403)
    expect(atAsk.body['error']).toContain('at ask')
    // The copy tool asks the owner itself; once approved, ws may move that one file and nothing else.
    const [waiting] = await calls(asking, [{ name: 'copy', args: { from: { on: 'workspace', path: 'data.bin' }, to: { on: 'box', path: 'in/data.bin' }, reason: 'Work on it' } }])
    expect(waiting).toContain('waiting for your owner')
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${asking}/conversation`)).body
    const ask = conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' && item.proposal.status === 'open' ? [item.proposal] : []))[0]!
    scripts.set(asking, [{ text: 'Copied.' }])
    expect((await api(ANNA, `/api/robots/${asking}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: true } })).status).toBe(200)
    await settle(asking)
    expect(sameBytes(boxBytes(asking, '/workspace/in/data.bin'), binary(1000))).toBe(true)
    expect((await presign(tokenOf(asking), { op: 'get', path: 'data.bin' })).status).toBe(403)
  })

  it('writes only the keys the tools write: not an owner\'s file, not the docs', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    for (const path of ['USER.md', 'PROACTIVE_PREFERENCES.md', 'docs/box.md']) {
      expect((await presign(tokenOf(id), { op: 'put', path, size: 3 })).status).toBe(400)
      expect((await presign(tokenOf(id), { op: 'part', path, number: 1 })).status).toBe(400)
      expect((await presign(tokenOf(id), { op: 'rm', path })).status).toBe(400)
    }
    expect((await presign(tokenOf(id), { op: 'put', path: 'ok.bin', size: 3 })).status).toBe(200)
  })
})

/** The secret a copy's ws sends with its requests (none for a script's ws). */
const permitOf = (init: RequestInit | undefined): string | undefined => new Headers(init?.headers).get('x-mr-robot-permit') ?? undefined

/** A script on the Box asks the door, over the Box's own network, with or without a permit it got hold of: the status. */
async function scriptAsks(network: BoxNetwork, token: string, body: unknown, permit?: string): Promise<number> {
  const response = await network(PRESIGN, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(permit === undefined ? {} : { 'x-mr-robot-permit': permit }) }, body: JSON.stringify(body) })
  return response.status
}

/** The owner approves the one open tool-call Ask of a Robot; the approved call runs. */
async function approveAsk(id: string): Promise<void> {
  const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
  const ask = conversation.items.flatMap((item) => (item.kind === 'proposal' && item.proposal.kind === 'tool-call' && item.proposal.status === 'open' ? [item.proposal] : []))[0]!
  scripts.set(id, [{ text: 'Copied.' }])
  expect((await api(ANNA, `/api/robots/${id}/proposals/${ask.id}`, { body: { revision: ask.revision, approve: true } })).status).toBe(200)
  await settle(id)
}

describe('a copy\'s permit at the Box\'s door (deep review P4)', () => {
  it('lets only the copy\'s own ws through, for its one key and direction, and only while the copy runs', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'ask' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    await env.FILES.put(`robots/${id}/data.bin`, binary(1000))
    await env.FILES.put(`robots/${id}/other.bin`, 'other')
    const token = tokenOf(id)
    let permit: string | undefined
    const seen: Record<string, number> = {}
    wsTaps.set(id, async (url, init, network) => {
      if (permit !== undefined || new URL(url).pathname !== '/api/files/presign') return
      permit = permitOf(init)
      // Another script, while the approved copy of data.bin runs: without the permit it is at ask like any script.
      seen['script put'] = await scriptAsks(network, token, { op: 'put', path: 'data.bin', size: 3 })
      seen['script rm'] = await scriptAsks(network, token, { op: 'rm', path: 'data.bin' })
      seen['script part'] = await scriptAsks(network, token, { op: 'part', path: 'data.bin', number: 1 })
      // With the copy's permit it may fetch data.bin, as the copy does, and nothing else.
      seen['permit get'] = await scriptAsks(network, token, { op: 'get', path: 'data.bin' }, permit)
      seen['permit put'] = await scriptAsks(network, token, { op: 'put', path: 'data.bin', size: 3 }, permit)
      seen['permit part'] = await scriptAsks(network, token, { op: 'part', path: 'data.bin', number: 1 }, permit)
      seen['permit rm'] = await scriptAsks(network, token, { op: 'rm', path: 'data.bin' }, permit)
      seen['permit other'] = await scriptAsks(network, token, { op: 'get', path: 'other.bin' }, permit)
      seen['permit ls'] = await scriptAsks(network, token, { op: 'ls', path: '' }, permit)
    })
    const [waiting] = await calls(id, [{ name: 'copy', args: { from: { on: 'workspace', path: 'data.bin' }, to: { on: 'box', path: 'in/data.bin' }, reason: 'Work on it' } }])
    expect(waiting).toContain('waiting for your owner')
    await approveAsk(id)
    expect(sameBytes(boxBytes(id, '/workspace/in/data.bin'), binary(1000))).toBe(true)
    expect(permit).toMatch(/^[0-9a-f]{64}$/)
    // The permit is not in the command the Box ran.
    expect(boxLog.get(id)!.some((entry) => entry.includes(permit!))).toBe(false)
    expect(seen).toEqual({ 'script put': 403, 'script rm': 403, 'script part': 403, 'permit get': 200, 'permit put': 403, 'permit part': 403, 'permit rm': 403, 'permit other': 403, 'permit ls': 403 })
    expect(sameBytes(await workspaceBytes(id, 'data.bin'), binary(1000))).toBe(true)
    // The copy ended, and its permit with it.
    expect((await presign(token, { op: 'get', path: 'data.bin' })).status).toBe(403)
    const after = await SELF.fetch(PRESIGN, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-mr-robot-permit': permit! }, body: JSON.stringify({ op: 'get', path: 'data.bin' }) })
    expect(after.status).toBe(403)
  })

  it('copies between the Box and a Host on the box grant and the Host\'s files facet, without the files group', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    const bytes = binary(3 * MIB + 1)
    boxDisks.get(id)!.set('/workspace/out/result.bin', { bytes, mtime: 1 })
    hostDisk.set('/home/anna/input.bin', binary(2000))
    const token = tokenOf(id)
    const seen: Record<string, number> = {}
    wsTaps.set(id, async (url, init, network) => {
      const permit = permitOf(init)
      if (permit === undefined || Object.keys(seen).length > 0 || JSON.parse(String(init?.body))['op'] !== 'part') return
      const staged = String(JSON.parse(String(init?.body))['path'])
      // The upload of the staged file has started: its permit starts no second upload, and reads or deletes nothing.
      seen['permit put'] = await scriptAsks(network, token, { op: 'put', path: staged, size: 3 }, permit)
      seen['permit get'] = await scriptAsks(network, token, { op: 'get', path: staged }, permit)
      seen['permit rm'] = await scriptAsks(network, token, { op: 'rm', path: staged }, permit)
      seen['script ls'] = await scriptAsks(network, token, { op: 'ls', path: '' })
    })
    const [toHost, toBox] = await calls(id, [
      { name: 'copy', args: { from: { on: 'box', path: 'out/result.bin' }, to: { on: 'Desk', path: '/home/anna/result.bin' } } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/input.bin' }, to: { on: 'box', path: 'in/input.bin' } } },
    ])
    expect(json(toHost)).toMatchObject({ to: { on: 'Desk', path: '/home/anna/result.bin' }, bytes: bytes.length })
    expect(json(toBox)).toMatchObject({ to: { on: 'box', path: '/workspace/in/input.bin' }, bytes: 2000 })
    expect(sameBytes(hostDisk.get('/home/anna/result.bin'), bytes)).toBe(true)
    expect(sameBytes(boxBytes(id, '/workspace/in/input.bin'), binary(2000))).toBe(true)
    expect(seen).toEqual({ 'permit put': 403, 'permit get': 403, 'permit rm': 403, 'script ls': 403 })
  })

  it('closes when the box grant is taken back or the Space switches the plugin off, without a new Turn', async () => {
    const id = await robotWith({ tools: { box: 'allow', files: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    const token = tokenOf(id)
    expect((await presign(token, { op: 'ls', path: '' })).status).toBe(200)
    for (const plugin of ['box', 'files']) {
      expect((await api(ANNA, `/api/admin/plugins/${plugin}`, { method: 'PUT', body: { enabled: false } })).status).toBe(200)
      const closed = await presign(token, { op: 'ls', path: '' })
      expect(closed.status).toBe(403)
      expect(closed.body['error']).toContain(`the tool group "${plugin}"`)
      expect((await api(ANNA, `/api/admin/plugins/${plugin}`, { method: 'PUT', body: { enabled: true } })).status).toBe(200)
      expect((await presign(token, { op: 'ls', path: '' })).status).toBe(200)
    }
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { files: 'allow' }, hosts: {} } } })
    expect((await presign(token, { op: 'ls', path: '' })).status).not.toBe(200)
  })
})
