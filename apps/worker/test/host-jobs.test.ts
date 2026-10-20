/**
 * Jobs on a Host (v1.16 ticket 03): the Host app runs commands as jobs of DSH's jobs-local, and the Robot's one registry treats them like
 * Box jobs. Driven through the edge API with the scripted model and the fake Host app, which holds jobs as the real app does (the app's own
 * jobs are checked in apps/host): promotion at the limit, a job at once, output since the last read, kill, the finished Wake-up with the
 * log under spill/jobs/, and jobs lost when the app restarts or the Host stays away (ob-sja4, ob-ku5j, ob-6kkn, ob-cgn1).
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { frame } from '@mr-robot/host-protocol'
import { closeHosts, fakeHost, heldCommands, hostJobCalls, hostJobs, hostRuns } from './fake-host.ts'
import { holdBoxJob } from './stub-box.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'
import type { Member as TestMember } from './worker.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  hostRuns.length = 0
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})
afterEach(closeHosts)

async function robotOn(host: { hostId: string }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget: 32_000, grants: { tools: {}, hosts: { [`${host.hostId}:shell`]: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

async function say(id: string, script: StubReply[]): Promise<Record<string, any>[]> {
  // The stub consumes the script as it answers: count the calls first.
  const calls = script.reduce((count, reply) => count + ('calls' in reply && reply.calls !== undefined ? reply.calls.length : 0), 0)
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  return requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join('')).slice(-calls)
    .map((text) => { try { return JSON.parse(text) as Record<string, any> } catch { return { error: text } } })
}
const run = (command: string, extra: Record<string, unknown> = {}) => ({ name: 'run', args: { on: 'Desk', command, ...extra } })
const jobOutput = (job_id: string, extra: Record<string, unknown> = {}) => ({ name: 'job_output', args: { job_id, ...extra } })
const jobList = { name: 'job_list', args: {} }
/** Each Host job message the Robot was woken with, once (a later request carries it in its history too). */
const wakes = (id: string) => [...new Set(requests.get(id)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message))).filter((text) => text.includes('[Desk job ')))]
const workspaceText = async (id: string, path: string) => (await (await env.FILES.get(`robots/${id}/${path}`))?.text()) ?? null
const tick = async (id: string) => {
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}
const member = () => env.MEMBER.getByName(annaId) as unknown as DurableObjectStub<TestMember>
/** Start a held command as a job and give back its id. */
async function startJob(id: string, command: string): Promise<string> {
  heldCommands.add(command)
  const [started] = await say(id, [{ calls: [run(command, { run_in_background: true })] }, { text: '' }])
  expect(started).toMatchObject({ kind: 'background', jobId: expect.stringMatching(/^j-/) })
  return started!.jobId as string
}

describe('run on a Host waits up to its limit, then goes on as a job (ob-sja4)', () => {
  it('a command that ends in time is a plain result and leaves no job; one past the limit is promoted with its output so far', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    heldCommands.add('make all')
    // The program prints once the job exists on the app.
    const printer = setInterval(() => { try { desk.print('make all', 'cc a.c\n'); clearInterval(printer) } catch { /* not started yet */ } }, 25)
    const [quick, slow, list] = await say(id, [{ calls: [run('echo quick'), run('make all', { timeout_seconds: 1 }), jobList] }, { text: '' }])
    clearInterval(printer)
    expect(quick).toMatchObject({ kind: 'foreground', stdout: 'ran: echo quick', exitCode: 0 })
    expect(slow).toMatchObject({ kind: 'promoted', stdout: 'cc a.c\n', stderr: '', jobId: expect.stringMatching(/^j-/) })
    expect(slow!.note).toContain(`goes on as job ${slow!.jobId}`)
    // The app was told to wait one second, and it is the app that waited: the Robot made one call.
    expect(hostRuns.map((call) => [call.command, call.background, call.timeoutMs])).toEqual([['echo quick', false, 120_000], ['make all', false, 1000]])
    expect(list!.jobs).toEqual([expect.objectContaining({ id: slow!.jobId, place: 'Desk', command: 'make all', status: 'running' })])
  })

  it('run_in_background answers at once with a job id, and the app was asked for a job', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const started = Date.now()
    const jobId = await startJob(id, 'python3 -m http.server')
    expect(Date.now() - started).toBeLessThan(5000)
    expect(hostRuns[0]).toMatchObject({ command: 'python3 -m http.server', background: true })
    const [list] = await say(id, [{ calls: [jobList] }, { text: '' }])
    expect(list!.jobs).toEqual([expect.objectContaining({ id: jobId, place: 'Desk', status: 'running', exitCode: null })])
  })
})

describe('job_output gives what came since the last read, and waits (ob-6kkn)', () => {
  it('reads from where the Robot stopped, on both streams, and with wait returns when the job ends', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make all')
    desk.print('make all', 'cc a.c\ncc b.c\n')
    desk.print('make all', 'warning: slow\n', 'err')
    const [first, nothing] = await say(id, [{ calls: [jobOutput(jobId), jobOutput(jobId)] }, { text: '' }])
    expect(first).toMatchObject({ jobId, status: 'running', stdout: 'cc a.c\ncc b.c\n', stderr: 'warning: slow\n' })
    expect(nothing).toMatchObject({ status: 'running', stdout: '', stderr: '' })
    desk.print('make all', 'cc c.c\n')
    const [more] = await say(id, [{ calls: [jobOutput(jobId)] }, { text: '' }])
    expect(more).toMatchObject({ stdout: 'cc c.c\n' })
    // With wait it returns at the end of the job, not at the timeout.
    setTimeout(() => desk.finish('make all', { stdout: 'done\n', exitCode: 2 }), 400)
    scripts.set(id, [{ calls: [jobOutput(jobId, { wait: true, timeout_seconds: 20 })] }, { text: '' }])
    const waitedFrom = Date.now()
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'wait' } })
    await settle(id)
    const result = JSON.parse(requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').at(-1)!.content.map((block) => ('text' in block ? block.text : '')).join('')) as Record<string, unknown>
    expect(result).toMatchObject({ jobId, status: 'completed', exitCode: 2, stdout: 'done\n' })
    expect(Date.now() - waitedFrom).toBeLessThan(10_000)
  })

  it('with a short wait returns still running when the job does not end', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'sleep 3600')
    const [waited] = await say(id, [{ calls: [jobOutput(jobId, { wait: true, timeout_seconds: 1 })] }, { text: '' }])
    expect(waited).toMatchObject({ status: 'running', note: expect.stringContaining('still running') })
  })
})

describe('job_kill stops a job on the Host', () => {
  it('asks the app to stop it, keeps its output under spill/jobs/ and does not wake the Robot', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'tail -f log')
    desk.print('tail -f log', 'line 1\n')
    const [killed, again] = await say(id, [{ calls: [{ name: 'job_kill', args: { job_id: jobId } }, { name: 'job_kill', args: { job_id: jobId } }] }, { text: '' }])
    expect(killed).toEqual({ jobId, status: 'killed' })
    expect(again).toEqual({ jobId, status: 'already killed' })
    expect(hostJobCalls.filter((call) => call.startsWith('JobKill'))).toHaveLength(1)
    expect(await workspaceText(id, `spill/jobs/${jobId}.log`)).toContain('line 1')
    scripts.set(id, [{ text: '' }])
    await tick(id)
    expect(wakes(id)).toEqual([])
  })
})

describe('a finished job wakes the Robot (ob-ku5j)', () => {
  it('on the job frame: its id, exit code and the last 40 lines, the whole log under spill/jobs/, and only once', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'python3 report.py')
    scripts.set(id, [{ calls: [{ name: 'say', args: { text: 'The report is done.' } }] }, { text: '' }])
    const lines = Array.from({ length: 120 }, (_, index) => `row ${index + 1}`).join('\n') + '\n'
    desk.finish('python3 report.py', { stdout: lines, stderr: 'warning: slow disk\n', exitCode: 0 })
    await vi.waitFor(() => expect(wakes(id)).toHaveLength(1), { timeout: 10_000 })
    await settle(id)
    const [wake] = wakes(id)
    expect(wake).toContain(`[Desk job ${jobId} finished: exit 0]`)
    expect(wake).toContain('$ python3 report.py')
    expect(wake).toContain('row 120')
    expect(wake).toContain('row 81')
    expect(wake).not.toContain('row 80\\n')
    expect(wake).toContain('earlier lines')
    expect(wake).toContain('warning: slow disk')
    expect(wake).toContain(`The whole output is in spill/jobs/${jobId}.log`)
    const log = await workspaceText(id, `spill/jobs/${jobId}.log`)
    expect(log).toContain('row 1\n')
    expect(log).toContain('row 120')
    expect(log).toContain('--- stderr ---\nwarning: slow disk')
    // The alarm finds nothing more to say.
    await tick(id)
    expect(wakes(id)).toHaveLength(1)
    const [list] = await say(id, [{ calls: [jobList] }, { text: '' }])
    expect(list!.jobs).toEqual([expect.objectContaining({ id: jobId, status: 'completed', exitCode: 0, log: `spill/jobs/${jobId}.log` })])
  })

  it('when the frame never came (the connection was down), the alarm asks the app and wakes the Robot', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make test')
    desk.finish('make test', { stderr: 'FAILED\n', exitCode: 2, frame: false })
    scripts.set(id, [{ text: '' }])
    await tick(id)
    expect(wakes(id)[0]).toContain(`[Desk job ${jobId} finished: exit 2]`)
    expect(wakes(id)[0]).toContain('FAILED')
  })

  it('a job promoted from the foreground wakes the Robot too', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    heldCommands.add('sleep 30 && echo ok')
    const [promoted] = await say(id, [{ calls: [run('sleep 30 && echo ok', { timeout_seconds: 1 })] }, { text: '' }])
    scripts.set(id, [{ text: '' }])
    desk.finish('sleep 30 && echo ok', { stdout: 'ok\n' })
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${promoted!.jobId} finished: exit 0]`), { timeout: 10_000 })
  })
})

describe('a job frame speaks only for a job of its own Host (v1.16 deep P3)', () => {
  it('a frame from another Host, or about a Box job, closes nothing; the Host that runs the job still closes it', async () => {
    const desk = await fakeHost()
    // Paired by the same Member; the Robot holds no grant on it.
    const nas = await fakeHost('Nas')
    const id = await robotOn(desk)
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { grants: { tools: { box: 'allow', files: 'allow' }, hosts: { [`${desk.hostId}:shell`]: 'allow' } } } })
    const deskJob = await startJob(id, 'make all')
    holdBoxJob(id, 'python3 train.py')
    const [boxStarted] = await say(id, [{ calls: [{ name: 'run', args: { on: 'box', command: 'python3 train.py', run_in_background: true } }] }, { text: '' }])
    const boxJob = boxStarted!.jobId as string
    expect(boxJob).toMatch(/^j-/)
    const forged = (job: string) => frame({ t: 'job', d: { job: `${id}:${job}`, state: 'completed', exitCode: 0, signal: null } })
    nas.socket.send(forged(deskJob))
    nas.socket.send(forged(boxJob))
    desk.socket.send(forged(boxJob))
    scripts.set(id, [{ text: '' }])
    // Desk's own frame for its job comes after the forged ones and is the only one that counts.
    desk.finish('make all', { exitCode: 3 })
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${deskJob} finished: exit 3]`), { timeout: 10_000 })
    await settle(id)
    const woken = requests.get(id)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message)))
    expect(woken.some((text) => text.includes('[Box job ') || text.includes('[Nas job '))).toBe(false)
    const [list] = await say(id, [{ calls: [jobList] }, { text: '' }])
    expect(list!.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: boxJob, place: 'box', status: 'running' }),
      expect.objectContaining({ id: deskJob, place: 'Desk', status: 'completed', exitCode: 3 }),
    ]))
  })
})

describe('jobs lost when the Host goes (ob-cgn1)', () => {
  it('a connection that drops and returns with the same app loses nothing', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make all')
    desk.print('make all', 'step 1\n')
    await desk.blip()
    scripts.set(id, [{ text: '' }])
    await tick(id)
    expect(wakes(id)).toEqual([])
    const [output] = await say(id, [{ calls: [jobOutput(jobId)] }, { text: '' }])
    expect(output).toMatchObject({ status: 'running', stdout: 'step 1\n' })
    desk.finish('make all')
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${jobId} finished: exit 0]`), { timeout: 10_000 })
  })

  it('an app that restarted has lost its jobs: the Robot is woken as failed, once, as soon as the new run says hello', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make all')
    scripts.set(id, [{ text: '' }])
    await desk.restart()
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${jobId} failed: the Mr. Robot app on Desk was restarted while it ran]`), { timeout: 10_000 })
    await settle(id)
    await tick(id)
    expect(wakes(id)).toHaveLength(1)
    const [list] = await say(id, [{ calls: [jobList] }, { text: '' }])
    expect(list!.jobs).toEqual([expect.objectContaining({ id: jobId, status: 'lost', exitCode: null })])
    expect(hostJobs.size).toBe(0)
  })

  it('a Host that stays away is waited for five minutes, then its jobs are lost', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make all')
    await desk.drop()
    scripts.set(id, [{ text: '' }])
    await member().sweepHosts(Date.now() + 2 * 60_000)
    await settle(id)
    expect(wakes(id)).toEqual([])
    await member().sweepHosts(Date.now() + 6 * 60_000)
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${jobId} failed: Desk stayed offline for more than 5 minutes while it ran]`), { timeout: 10_000 })
  })

  it('unpairing the Host loses its jobs', async () => {
    const desk = await fakeHost()
    const id = await robotOn(desk)
    const jobId = await startJob(id, 'make all')
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/hosts/${desk.hostId}`, { method: 'DELETE' })).status).toBe(200)
    await vi.waitFor(() => expect(wakes(id)[0]).toContain(`[Desk job ${jobId} failed: Desk was unpaired while it ran]`), { timeout: 10_000 })
  })
})

describe('a Host the Robot can no longer reach (S6)', () => {
  it('marks its running jobs lost and wakes the Robot as failed when sharing ends', async () => {
    const BEN = 'ben@example.com'
    const desk = await fakeHost()
    await api(ANNA, `/api/hosts/${desk.hostId}`, { method: 'PATCH', body: { sharing: 'home' } })
    await api(ANNA, '/api/admin/members', { body: { email: BEN } })
    await api(BEN, '/api/me')
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(BEN, '/api/robots', { body: {} })
    await settle(body.id)
    await api(BEN, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget: 32_000, grants: { tools: {}, hosts: { [`${desk.hostId}:shell`]: 'allow' } } } })
    await testRobot(body.id).activateForTest()
    requests.delete(body.id)
    heldCommands.add('sleep 1000')
    scripts.set(body.id, [{ calls: [run('sleep 1000', { run_in_background: true })] }, { text: '' }])
    await api(BEN, `/api/robots/${body.id}/messages`, { body: { text: 'go' } })
    await settle(body.id)
    // Still shared: the alarm finds the job running.
    await tick(body.id)
    expect(wakes(body.id)).toEqual([])
    // The owner stops sharing: the Host is not Ben's to reach any more, and the job never will end.
    await api(ANNA, `/api/hosts/${desk.hostId}`, { method: 'PATCH', body: { sharing: 'private' } })
    scripts.set(body.id, [{ text: 'I know.' }])
    await tick(body.id)
    expect(wakes(body.id).some((text) => text.includes('[Desk job ') && text.includes('failed') && text.includes('sleep 1000'))).toBe(true)
  })
})
