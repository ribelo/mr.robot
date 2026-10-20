/**
 * Files without limit (v1.16 ticket 06): the Box's token door and ws, and copy between the Workspace, the Box and Hosts over presigned R2 URLs.
 * Driven through the edge API with the scripted model, the stub Box (which runs the real ws program), the fake Host app (which runs the real
 * copy engine) and R2 played by the FILES binding behind the URLs the Worker's real signer made (fake-r2.ts).
 */
import { env, reset, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostCopies, hostDisk } from './fake-host.ts'
import { r2Faults, r2Log } from './fake-r2.ts'
import { boxDisks, boxLog, boxScripts } from './stub-box.ts'
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
    const id = await robotWith({ tools: { box: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    const token = tokenOf(id)
    expect(token.startsWith(`${id}.`)).toBe(true)
    await env.FILES.put(`robots/${id}/inbox/a.bin`, binary(1000))

    const link = await presign(token, { op: 'get', path: 'inbox/a.bin' })
    expect(link.status).toBe(200)
    expect(link.body['size']).toBe(1000)
    const url = new URL(link.body['url'])
    expect(url.origin + url.pathname).toBe(`https://test-account.r2.cloudflarestorage.com/files/robots/${id}/inbox/a.bin`)
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeGreaterThan(0)
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    // A path is a key under the prefix or it is refused: nothing outside it is ever signed.
    for (const path of ['../r-other/secret', '/etc/passwd', 'a/../../b']) expect((await presign(token, { op: 'get', path })).status).toBe(400)
    const inside = await presign(token, { op: 'put', path: 'robots/r-other/x', size: 5 })
    expect(new URL(inside.body['parts'][0].url).pathname).toBe(`/files/robots/${id}/robots/r-other/x`)
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
    const one = await robotWith({ tools: { box: 'allow' } })
    const two = await robotWith({ tools: { box: 'allow' } })
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
    const id = await robotWith({ tools: { box: 'allow' } })
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'echo up' } }])
    boxDisks.get(id)!.set('/workspace/v.bin', { bytes: binary(11 * MIB), mtime: 1 })
    r2Log.length = 0
    await calls(id, [{ name: 'run', args: { on: 'box', command: 'ws put v.bin kept/v.bin' } }, { name: 'run', args: { on: 'box', command: 'ws get kept/v.bin w.bin' } }])
    expect(r2Log.filter((entry) => entry.method === 'PUT').map((entry) => entry.part)).toEqual([1, 2, 3])
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
    // The Host app moved the bytes: three parts up, three ranges down, every request on a link for a key of this Robot.
    expect(hostCopies).toEqual([{ rpc: 'Upload', path: '/home/anna/video.bin', size: bytes.length, parts: 3 }, { rpc: 'Download', path: '/home/anna/back/video.bin', size: bytes.length, parts: 3 }])
    expect(r2Log.every((entry) => entry.key === `robots/${id}/inbox/video.bin`)).toBe(true)
    expect(r2Log).toHaveLength(6)
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
