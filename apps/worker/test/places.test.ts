/**
 * The one execution surface (v1.16 ticket 01): run, the file tools, copy and the job tools, each with a mandatory `on`: workspace, box or a
 * Host's name. Driven through the edge API with the scripted model, the stub Box and the fake Host app.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { closeHosts, fakeHost, hostCommands, hostDisk } from './fake-host.ts'
import { boxDisks, boxLog, boxScripts, finishBoxJob, holdBoxJob } from './stub-box.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  boxLog.clear()
  boxDisks.clear()
  boxScripts.clear()
  hostDisk.clear()
  hostCommands.length = 0
  await stubModels()
  await api(ANNA, '/api/me')
})

afterEach(closeHosts)

async function robotWith(grants: { tools?: Record<string, string>; hosts?: Record<string, string> }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { contextBudget: 32_000, grants: { tools: grants.tools ?? {}, hosts: grants.hosts ?? {} } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

type Call = { name: string; args: Record<string, unknown>; native?: true }
/** The calls go one after the other, one step each; the results come back in the same order. */
async function calls(id: string, list: Call[]): Promise<string[]> {
  scripts.set(id, [...list.map((call): StubReply => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join('')).slice(-list.length)
}
const json = (text: string | undefined) => JSON.parse(text!) as Record<string, unknown>
const workspaceText = async (id: string, path: string) => (await (await env.FILES.get(`robots/${id}/${path}`))?.text()) ?? null

describe('each tool on each place (ob-5fjs, ob-ff4g, ob-9afl)', () => {
  it('works the Workspace, the Box and a Host with the same tools', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow', [`${desk.hostId}:shell`]: 'allow' } })
    boxScripts.set(id, (command) => (command === 'pwd' ? { stdout: '/workspace\n' } : undefined))
    const text = (content: string) => new TextEncoder().encode(content)
    hostDisk.set('docs/a.md', text('alpha\nbeta\n'))
    hostDisk.set('docs/b.txt', text('nothing\n'))
    hostDisk.set('README.md', text('readme\n'))
    hostDisk.set('notes/z.md', text('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nbeta again\n'))
    const results = await calls(id, [
      // The Workspace
      { name: 'write', args: { on: 'files', file_path: 'notes/a.md', content: 'alpha\nbeta\n' } },
      { name: 'read', args: { on: 'files', file_path: 'notes/a.md' } },
      { name: 'edit', args: { on: 'files', file_path: 'notes/a.md', old_string: 'beta', new_string: 'gamma' } },
      { name: 'glob', args: { on: 'files', pattern: 'notes/**' } },
      { name: 'grep', args: { on: 'files', pattern: 'gamma' } },
      // The Box
      { name: 'write', args: { on: 'box', file_path: 'work/b.txt', content: 'one\ntwo\n' } },
      { name: 'read', args: { on: 'box', file_path: '/workspace/work/b.txt' } },
      { name: 'edit', args: { on: 'box', file_path: 'work/b.txt', old_string: 'two', new_string: 'three' } },
      { name: 'glob', args: { on: 'box', pattern: 'work/*' } },
      { name: 'grep', args: { on: 'box', pattern: 'three' } },
      { name: 'run', args: { on: 'box', command: 'pwd' } },
      { name: 'delete_file', args: { on: 'box', path: 'work/b.txt' } },
      // A Host
      { name: 'write', args: { on: 'Desk', file_path: '/home/anna/h.txt', content: 'host text' } },
      { name: 'read', args: { on: 'Desk', file_path: '/home/anna/h.txt' } },
      { name: 'edit', args: { on: 'Desk', file_path: '/home/anna/h.txt', old_string: 'text', new_string: 'words' } },
      { name: 'glob', args: { on: 'Desk', pattern: 'docs/*.md' } },
      { name: 'grep', args: { on: 'Desk', pattern: 'beta', glob: 'docs/*' } },
      { name: 'run', args: { on: 'Desk', command: 'uptime' } },
      { name: 'delete_file', args: { on: 'Desk', path: '/home/anna/h.txt' } },
      // The Workspace to a Host and back, to the Box and back, inside the Workspace
      { name: 'copy', args: { from: { on: 'files', path: 'notes/a.md' }, to: { on: 'Desk', path: '/home/anna/copy.md' } } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/copy.md' }, to: { on: 'files', path: 'inbox/copy.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'notes/a.md' }, to: { on: 'box', path: 'box/in.md' } } },
      { name: 'copy', args: { from: { on: 'box', path: 'box/in.md' }, to: { on: 'files', path: 'inbox/from-box.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'notes/a.md' }, to: { on: 'files', path: 'notes/b.md' } } },
    ])
    const [wWrite, wRead, wEdit, wGlob, wGrep, bWrite, bRead, bEdit, bGlob, bGrep, bRun, bDelete, hWrite, hRead, hEdit, hGlob, hGrep, hRun, hDelete, c1, c2, c3, c4, c5] = results
    expect(json(wWrite)).toMatchObject({ on: 'files', written: '/workspace/notes/a.md', bytes: 11 })
    expect(wRead).toContain('2: beta')
    expect(json(wEdit)).toMatchObject({ on: 'files', edited: '/workspace/notes/a.md' })
    expect(JSON.parse(wGlob!)).toEqual({ paths: ['notes/a.md'], truncated: false })
    expect(JSON.parse(wGrep!)).toEqual({ matches: [{ path: 'notes/a.md', line: 2, text: 'gamma' }], truncated: false })
    expect(json(bWrite)).toMatchObject({ on: 'box', written: '/workspace/work/b.txt', bytes: 8 })
    expect(bRead).toContain('2: two')
    expect(json(bEdit)).toMatchObject({ on: 'box', edited: '/workspace/work/b.txt' })
    expect(JSON.parse(bGlob!)).toEqual({ paths: ['work/b.txt'], truncated: false })
    expect(JSON.parse(bGrep!)).toEqual({ matches: [{ path: 'work/b.txt', line: 2, text: 'three' }], truncated: false })
    expect(json(bRun)).toEqual({ kind: 'foreground', stdout: '/workspace\n', stderr: '', exitCode: 0 })
    expect(json(bDelete)).toEqual({ deleted: '/workspace/work/b.txt' })
    expect(boxDisks.get(id)!.has('/workspace/work/b.txt')).toBe(false)
    expect(json(hWrite)).toMatchObject({ on: 'Desk', written: '/home/anna/h.txt', bytes: 9 })
    expect(hRead).toContain('1: host text')
    expect(json(hEdit)).toMatchObject({ on: 'Desk', edited: '/home/anna/h.txt' })
    expect(JSON.parse(hGlob!)).toEqual({ paths: ['docs/a.md'], truncated: false })
    expect(JSON.parse(hGrep!)).toEqual({ matches: [{ path: 'docs/a.md', line: 2, text: 'beta' }], truncated: false })
    expect(json(hRun)).toMatchObject({ kind: 'foreground', stdout: 'ran: uptime', exitCode: 0 })
    expect(json(hDelete)).toEqual({ deleted: '/home/anna/h.txt' })
    expect(hostDisk.has('/home/anna/h.txt')).toBe(false)
    expect(json(c1)).toMatchObject({ from: { on: 'files', path: '/workspace/notes/a.md' }, to: { on: 'Desk', path: '/home/anna/copy.md' }, bytes: 12 })
    expect(new TextDecoder().decode(hostDisk.get('/home/anna/copy.md'))).toBe('alpha\ngamma\n')
    expect(json(c2)).toMatchObject({ to: { on: 'files', path: '/workspace/inbox/copy.md' }, bytes: 12 })
    expect(await workspaceText(id, 'inbox/copy.md')).toBe('alpha\ngamma\n')
    expect(json(c3)).toMatchObject({ to: { on: 'box', path: '/workspace/box/in.md' } })
    expect(new TextDecoder().decode(boxDisks.get(id)!.get('/workspace/box/in.md')!.bytes)).toBe('alpha\ngamma\n')
    expect(json(c4)).toMatchObject({ to: { on: 'files', path: '/workspace/inbox/from-box.md' } })
    expect(await workspaceText(id, 'inbox/from-box.md')).toBe('alpha\ngamma\n')
    expect(json(c5)).toMatchObject({ bytes: 12 })
    expect(await workspaceText(id, 'notes/b.md')).toBe('alpha\ngamma\n')
  })

  it('has no default place: a call without on is refused, as is a copy end without one', async () => {
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' } })
    const [read, run, copy] = await calls(id, [
      { name: 'read', args: { file_path: 'SOUL.md' } },
      { name: 'run', args: { command: 'ls' } },
      { name: 'copy', args: { from: { path: 'SOUL.md' }, to: { on: 'box', path: 'x' } } },
    ])
    expect(read).toContain('parameter "on" is required')
    expect(run).toContain('parameter "on" is required')
    expect(copy).toContain('from.on is required')
    expect(boxLog.get(id)).toBeUndefined()
  })

  it('does not run commands on the Workspace', async () => {
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' } })
    const [run] = await calls(id, [{ name: 'run', args: { on: 'files', command: 'ls' } }])
    expect(run).toContain('your Files hold files, they run no commands')
  })
})

describe('glob and grep say when they stopped early (deep review P15)', () => {
  it('flags a Workspace search past its file limit, a Box search past its match limit and a Host listing past its file limit; skips .cache', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    const names = (count: number) => Array.from({ length: count }, (_, index) => `f${String(index).padStart(3, '0')}.txt`)
    for (const name of names(500)) await env.FILES.put(`robots/${id}/even/${name}`, 'nothing here')
    for (const name of names(501)) await env.FILES.put(`robots/${id}/over/${name}`, 'nothing here')
    for (let index = 0; index <= 20_000; index++) hostDisk.set(`tree/${index}.txt`, new Uint8Array())
    hostDisk.set('logs/hits.txt', new TextEncoder().encode('hit\n'.repeat(201)))
    const results = await calls(id, [
      { name: 'grep', args: { on: 'files', pattern: 'needle', glob: 'even/*' } },
      { name: 'grep', args: { on: 'files', pattern: 'needle', glob: 'over/*' } },
      { name: 'write', args: { on: 'box', file_path: 'proj/exact.txt', content: 'hit\n'.repeat(200) } },
      { name: 'write', args: { on: 'box', file_path: 'logs/hits.txt', content: 'hit\n'.repeat(201) } },
      { name: 'write', args: { on: 'box', file_path: 'proj/.cache/uv/hit.txt', content: 'hit\n' } },
      { name: 'grep', args: { on: 'box', pattern: 'hit', path: 'proj' } },
      { name: 'grep', args: { on: 'box', pattern: 'hit' } },
      { name: 'glob', args: { on: 'box', pattern: 'proj/**' } },
      { name: 'grep', args: { on: 'box', pattern: 'a(' } },
      { name: 'glob', args: { on: 'Desk', pattern: 'tree/**' } },
      { name: 'grep', args: { on: 'Desk', pattern: 'hit', path: 'logs' } },
    ])
    const [even, over, , , , boxExact, boxOver, boxGlob, boxBad, hostGlob, hostGrep] = results
    // A result over the context budget arrives cut; the whole of it is in the Workspace under spill/.
    const whole = async (text: string | undefined): Promise<{ matches?: unknown[]; paths?: unknown[]; truncated: boolean }> => {
      const spilled = /\/workspace\/(spill\/\S+?\.txt)/.exec(text!)?.[1]
      return JSON.parse(spilled === undefined ? text! : (await workspaceText(id, spilled))!)
    }
    expect(json(even)).toEqual({ matches: [], truncated: false })
    expect(json(over)).toEqual({ matches: [], truncated: true })
    expect(await whole(boxExact)).toMatchObject({ truncated: false, matches: expect.objectContaining({ length: 200 }) })
    expect(await whole(boxOver)).toMatchObject({ truncated: true, matches: expect.objectContaining({ length: 200 }) })
    expect(json(boxGlob)).toEqual({ paths: ['proj/exact.txt'], truncated: false })
    expect(boxBad).toContain('grep on your Box refused the pattern')
    expect(await whole(hostGlob)).toMatchObject({ truncated: true })
    expect(await whole(hostGrep)).toMatchObject({ truncated: true, matches: expect.objectContaining({ length: 200 }) })
  })
})

describe('the grants gate the places (ob-dyg4, ob-qnf7)', () => {
  it('refuses a place the Robot holds no grant on and names the grant; an unknown Host is refused with the Hosts it could name', async () => {
    const desk = await fakeHost()
    await fakeHost('Laptop')
    // The Box, and the files of Desk: no files group, no Desk shell.
    const id = await robotWith({ tools: { box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    const results = await calls(id, [
      { name: 'read', args: { on: 'files', file_path: 'SOUL.md' } },
      { name: 'run', args: { on: 'Desk', command: 'id' } },
      { name: 'read', args: { on: 'Laptop', file_path: '/etc/hostname' } },
      { name: 'read', args: { on: 'Nowhere', file_path: '/etc/hostname' } },
      { name: 'copy', args: { from: { on: 'Desk', path: '/home/anna/x' }, to: { on: 'files', path: 'x' } } },
      { name: 'read', args: { on: 'Desk', file_path: '/etc/hostname' } },
    ])
    expect(results[0]).toContain('you hold no grant on your Files (the tool group "files")')
    expect(results[1]).toContain('the grant "Desk · shell"')
    expect(results[2]).toContain('the grant "Laptop · files"')
    expect(results[3]).toContain('there is no such place')
    expect(results[3]).toContain('Desk, Laptop')
    expect(results[4]).toContain('the tool group "files"')
    expect(results[5]).toContain('1: hello')
    expect(hostCommands.length).toBe(0)
  })

  it('refuses the Box without the box grant even when the Robot holds a Host shell', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow' }, hosts: { [`${desk.hostId}:shell`]: 'allow' } })
    const [read, run] = await calls(id, [
      { name: 'read', args: { on: 'box', file_path: 'a.txt' } },
      { name: 'run', args: { on: 'box', command: 'ls' } },
    ])
    expect(read).toContain('you hold no grant on your Box (the tool group "box")')
    expect(run).toContain('the tool group "box"')
    expect(boxLog.get(id)).toBeUndefined()
  })

  it('puts a call to a place at ask to the owner by that place, not by the others', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow', box: 'ask' }, hosts: { [`${desk.hostId}:shell`]: 'allow' } })
    const [workspace, box, host] = await calls(id, [
      { name: 'write', args: { on: 'files', file_path: 'a.md', content: 'x' } },
      { name: 'run', args: { on: 'box', command: 'ls', reason: 'List the Box' } },
      { name: 'run', args: { on: 'Desk', command: 'uptime', reason: 'Check it' } },
    ])
    expect(workspace).toContain('"written"')
    expect(box).toContain('waiting for your owner')
    expect(host).toContain('ran: uptime')
    expect(boxLog.get(id)).toBeUndefined()
  })
})

describe('only the Workspace reaches the owned files (ob-pfcu)', () => {
  it('reads the Member files, the docs and the platform skills on workspace; the Box and a Host refuse them', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow', box: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    const results = await calls(id, [
      { name: 'read', args: { on: 'files', file_path: 'USER.md' } },
      { name: 'read', args: { on: 'files', file_path: 'docs/box.md' } },
      { name: 'read', args: { on: 'box', file_path: 'USER.md' } },
      { name: 'read', args: { on: 'box', file_path: '/workspace/docs/box.md' } },
      { name: 'write', args: { on: 'box', file_path: 'docs/skills/asking/SKILL.md', content: 'x' } },
      { name: 'read', args: { on: 'Desk', file_path: 'USER.md' } },
      { name: 'delete_file', args: { on: 'Desk', path: 'docs/robots.md' } },
      // A name that only looks like an owned file is the place's own.
      { name: 'write', args: { on: 'box', file_path: 'docs/mine.md', content: 'mine' } },
      { name: 'read', args: { on: 'Desk', file_path: '/docs/box.md' } },
      // And the Workspace refuses to change them.
      { name: 'write', args: { on: 'files', file_path: 'docs/box.md', content: 'mine' } },
    ])
    expect(results[0]).toContain('<path>/workspace/USER.md</path>')
    expect(results[1]).toContain('# The Box')
    for (const refused of results.slice(2, 7)) expect(refused).toContain('reachable only with on "files"')
    expect(json(results[7])).toMatchObject({ on: 'box', written: '/workspace/docs/mine.md' })
    expect(results[8]).toContain('1: hello')
    expect(results[9]).toContain('docs/')
    expect(results[9]).toContain('read-only')
  })
})

describe('one job registry for the Box and the Hosts (ob-rc3b)', () => {
  it('lists a Box job and a Host job together with their place; the Host job ends and wakes the Robot', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { box: 'allow' }, hosts: { [`${desk.hostId}:shell`]: 'allow' } })
    holdBoxJob(id, 'python3 serve.py')
    const [box, host, list] = await calls(id, [
      { name: 'run', args: { on: 'box', command: 'python3 serve.py', run_in_background: true } },
      { name: 'run', args: { on: 'Desk', command: 'backup --all', run_in_background: true } },
      { name: 'job_list', args: {} },
    ])
    expect(json(box)).toMatchObject({ kind: 'background', jobId: expect.stringMatching(/^j-/) })
    expect(json(host)).toMatchObject({ kind: 'background', jobId: expect.stringMatching(/^j-/) })
    const listed = (json(list).jobs as Array<{ id: string; place: string; command: string }>).map((job) => [job.place, job.command]).sort()
    expect(listed).toEqual([['Desk', 'backup --all'], ['box', 'python3 serve.py']])
    // The Host's command ended; the alarm looks at the jobs and wakes the Robot with its place named.
    scripts.set(id, [{ text: '' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const wakes = [...new Set(requests.get(id)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message))).filter((text) => text.includes('job ')))]
    expect(wakes.some((text) => text.includes('[Desk job ') && text.includes('finished: exit 0') && text.includes('ran: backup --all'))).toBe(true)
    const [, after] = await calls(id, [
      { name: 'job_output', args: { job_id: (json(host).jobId as string) } },
      { name: 'job_list', args: {} },
    ])
    expect((json(after).jobs as Array<{ place: string; status: string }>).find((job) => job.place === 'Desk')).toMatchObject({ status: 'completed' })
  })

  it('refuses job_output and job_kill for a job on a place the Robot no longer holds', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { box: 'allow' }, hosts: { [`${desk.hostId}:shell`]: 'allow' } })
    const [host] = await calls(id, [{ name: 'run', args: { on: 'Desk', command: 'sleep 1', run_in_background: true } }])
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { box: 'allow' }, hosts: {} } } })
    const [out, kill] = await calls(id, [
      { name: 'job_output', args: { job_id: json(host).jobId } },
      { name: 'job_kill', args: { job_id: json(host).jobId } },
    ])
    expect(out).toContain('the grant "Desk · shell"')
    expect(kill).toContain('the grant "Desk · shell"')
  })
})

describe('old events still render (ob-j9nx)', () => {
  it('shows the calls of the removed box_ and host_ tools in a Conversation that holds them', async () => {
    const id = await robotWith({ tools: { files: 'allow' } })
    const [boxRun, hostRead] = await calls(id, [
      // Native calls, as a Conversation from before v1.22 holds them.
      { name: 'box_run', args: { command: 'echo old' }, native: true },
      { name: 'host_read', args: { host: 'Desk', path: '/etc/hostname' }, native: true },
    ])
    expect(boxRun).toBeDefined()
    expect(hostRead).toBeDefined()
    const detailed = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation?details=1`)).body.items.filter((item) => item.kind === 'activity')
    const named = detailed.flatMap((item) => (item.kind === 'activity' ? (item.calls ?? []).map((call) => call.name) : []))
    expect(named).toEqual(expect.arrayContaining(['box_run', 'host_read']))
    const trajectory = JSON.stringify((await api(ANNA, `/api/robots/${id}/trajectory`)).body)
    expect(trajectory).toContain('box_run')
    expect(trajectory).toContain('host_read')
  })
})

describe('the upgrade from v1.15 (deep review P18)', () => {
  it('closes an Ask left open for a removed tool and tells the owner; an Ask for a tool that stays waits as before', async () => {
    const id = await robotWith({ tools: { box: 'ask', files: 'ask' } })
    const [old, kept] = await testRobot(id).legacyToolAsksForTest([
      { tool: 'box_run', arguments: { command: 'rm -rf build' }, reason: 'Clean the build' },
      { tool: 'write', arguments: { on: 'files', file_path: 'notes/a.md', content: 'milk' }, reason: 'Keep the list' },
    ])
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    const asks = items.flatMap((item) => (item.kind === 'proposal' ? [item.proposal] : []))
    const closed = asks.find((ask) => ask.id === old)
    expect(closed).toMatchObject({ status: 'done' })
    expect(asks.find((ask) => ask.id === kept)).toMatchObject({ status: 'open' })
    const notices = items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))
    expect(notices.filter((text) => text.includes('box_run no longer exists'))).toHaveLength(1)
    // An approval that arrives for the closed Ask is refused: nothing runs and the Robot is not woken.
    expect((await api(ANNA, `/api/robots/${id}/proposals/${old}`, { body: { revision: closed!.revision, approve: true } })).status).toBe(409)
    await settle(id)
    expect(requests.get(id)).toBeUndefined()
    expect(boxLog.get(id) ?? []).toEqual([])
  })

  it('keeps the Box jobs of v1.15 as jobs on the box: listed with their place, and a running one wakes the Robot when it ends', async () => {
    const id = await robotWith({ tools: { box: 'allow' } })
    holdBoxJob(id, 'python3 serve.py')
    const [started] = await calls(id, [{ name: 'run', args: { on: 'box', command: 'python3 serve.py', run_in_background: true } }])
    const running = json(started).jobId as string
    await testRobot(id).legacyBoxJobsForTest({ id: 'j-00015aaa', command: 'make all', exitCode: 2 })
    const [list] = await calls(id, [{ name: 'job_list', args: {} }])
    const jobs = (json(list).jobs as Array<{ id: string; place: string; command: string; status: string; exitCode: number | null }>).map(({ id: job, place, command, status, exitCode }) => ({ job, place, command, status, exitCode }))
    expect(jobs).toEqual(expect.arrayContaining([
      { job: running, place: 'box', command: 'python3 serve.py', status: 'running', exitCode: null },
      { job: 'j-00015aaa', place: 'box', command: 'make all', status: 'completed', exitCode: 2 },
    ]))
    expect(jobs).toHaveLength(2)
    finishBoxJob(id, 'python3 serve.py', { stdout: 'served\n' })
    scripts.set(id, [{ text: '' }])
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const wakes = requests.get(id)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message)))
    expect(wakes.some((text) => text.includes(`[Box job ${running} finished: exit 0]`))).toBe(true)
  })
})

describe('a Robot in setup reaches its Workspace (S1)', () => {
  it('writes its persona file with write on workspace although it holds no files grant yet', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    const [written, outside] = await calls(body.id, [
      { name: 'write', args: { on: 'files', file_path: 'SOUL.md', content: 'I am calm.' } },
      { name: 'run', args: { on: 'box', command: 'ls' } },
    ])
    expect(json(written)).toMatchObject({ on: 'files', written: '/workspace/SOUL.md', bytes: 10 })
    expect(await workspaceText(body.id, 'SOUL.md')).toBe('I am calm.')
    // Setup opens the Workspace and nothing else.
    expect(outside).toBeDefined()
    expect(boxLog.get(body.id)).toBeUndefined()
  })
})

describe('copy keeps the owned paths in the Workspace (S5)', () => {
  it('refuses an owned name on the Host end, and copies an owner\'s file or a doc from the Workspace to a Host through its real source', async () => {
    const desk = await fakeHost()
    const id = await robotWith({ tools: { files: 'allow' }, hosts: { [`${desk.hostId}:files`]: 'allow' } })
    hostDisk.set('USER.md', new TextEncoder().encode('not the owner\'s file'))
    const results = await calls(id, [
      { name: 'copy', args: { from: { on: 'Desk', path: 'USER.md' }, to: { on: 'files', path: 'inbox/user.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'notes/none.md' }, to: { on: 'Desk', path: 'docs/box.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'docs/box.md' }, to: { on: 'Desk', path: '/home/anna/box.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'USER.md' }, to: { on: 'Desk', path: '/home/anna/user.md' } } },
      { name: 'copy', args: { from: { on: 'files', path: 'docs/none.md' }, to: { on: 'Desk', path: '/home/anna/none.md' } } },
    ])
    expect(results[0]).toContain('reachable only with on "files"')
    expect(await workspaceText(id, 'inbox/user.md')).toBeNull()
    expect(results[1]).toContain('reachable only with on "files"')
    expect(json(results[2])).toMatchObject({ from: { on: 'files', path: '/workspace/docs/box.md' }, to: { on: 'Desk', path: '/home/anna/box.md' } })
    expect(new TextDecoder().decode(hostDisk.get('/home/anna/box.md'))).toContain('# The Box')
    expect(json(results[3])).toMatchObject({ to: { on: 'Desk', path: '/home/anna/user.md' } })
    expect(hostDisk.has('/home/anna/user.md')).toBe(true)
    expect(results[4]).toContain('does not exist')
  })
})
