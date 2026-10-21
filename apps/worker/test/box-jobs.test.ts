/**
 * Box jobs (v1.15 ticket 07): run on the Box waits in the foreground up to its limit and then lets the command go on as a job; run_in_background
 * starts one at once; job_list, job_output and job_kill manage jobs; a finished job wakes the Robot; the Box stays up while a job runs.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RobotPanel } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { boxJobIds, boxLog, boxScripts, finishBoxJob, holdBoxJob, loseBoxJobs, printBoxJob } from './stub-box.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const MINUTE = 60_000

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  boxLog.clear()
  boxScripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robot(): Promise<string> {
  scripts.set('*', [{ text: '' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { contextBudget: 32_000, grants: { tools: { box: 'allow', files: 'allow' } } } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

const run = (command: string, extra: Record<string, unknown> = {}) => ({ name: 'run', args: { on: 'box', command, ...extra } })
async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}
const results = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const lastResults = (id: string, n: number) => results(id).slice(-n).map((text) => JSON.parse(text) as Record<string, any>)
const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
const workspaceText = async (id: string, path: string) => (await (await env.FILES.get(`robots/${id}/${path}`))?.text()) ?? null
/** Each Box job message the Robot was woken with, once (a later request carries it in its history too). */
const wakes = (id: string) => [...new Set(requests.get(id)!.flatMap((request) => request.messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message))).filter((text) => text.includes('[Box job ')))]
const tick = async (id: string) => {
  await runDurableObjectAlarm(env.ROBOT.getByName(id))
  await settle(id)
}

describe('run on the Box goes on as a job (gb-lnph, gb-lco0)', () => {
  it('a command that ends in time returns as before; one past the limit is not killed: it is promoted with its output so far', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 train.py')
    // The program prints once the job exists, however long the Robot takes to start it.
    const printer = setInterval(() => { try { printBoxJob(id, 'python3 train.py', 'epoch 1\n'); clearInterval(printer) } catch { /* not started yet */ } }, 50)
    await say(id, 'train it', [{ calls: [run('echo quick'), run('python3 train.py', { timeout_seconds: 1 })] }, { text: '' }])
    const [quick, slow] = lastResults(id, 2)
    expect(quick).toEqual({ kind: 'foreground', stdout: 'ran: echo quick', stderr: '', exitCode: 0 })
    expect(slow).toMatchObject({ kind: 'promoted', stdout: 'epoch 1\n', stderr: '', jobId: expect.stringMatching(/^j-/) })
    expect(slow!.note).toContain(`goes on as job ${slow!.jobId}`)
    clearInterval(printer)
    expect(await panel(id)).toMatchObject({ box: { state: 'running', jobs: [{ id: slow!.jobId, command: 'python3 train.py' }] } })
  })

  it('run_in_background returns a job id at once, without waiting', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 -m http.server')
    const started = Date.now()
    await say(id, 'serve', [{ calls: [run('python3 -m http.server', { run_in_background: true })] }, { text: '' }])
    const [job] = lastResults(id, 1)
    expect(job).toMatchObject({ kind: 'background', jobId: expect.stringMatching(/^j-/) })
    expect(Date.now() - started).toBeLessThan(5000)
    const listed = lastResults(id, 1)
    expect(boxJobIds(id)).toEqual([job!.jobId])
    void listed
  })

  it('job_list names the jobs with their status; job_output gives what came since the last read, and waits up to the timeout', async () => {
    const id = await robot()
    holdBoxJob(id, 'make all')
    await say(id, 'build', [{ calls: [run('make all', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    printBoxJob(id, 'make all', 'cc a.c\ncc b.c\n')
    await say(id, 'look', [{ calls: [{ name: 'job_list', args: {} }, { name: 'job_output', args: { job_id: jobId } }] }, { calls: [{ name: 'job_output', args: { job_id: jobId } }] }, { text: '' }])
    const [list, first] = lastResults(id, 3).slice(0, 2)
    expect(list!.jobs).toEqual([expect.objectContaining({ id: jobId, command: 'make all', status: 'running', exitCode: null })])
    expect(first).toMatchObject({ jobId, status: 'running', stdout: 'cc a.c\ncc b.c\n', stderr: '' })
    // Nothing new since the last read.
    expect(lastResults(id, 1)[0]).toMatchObject({ jobId, status: 'running', stdout: '', stderr: '' })
    printBoxJob(id, 'make all', 'cc c.c\n')
    await say(id, 'again', [{ calls: [{ name: 'job_output', args: { job_id: jobId } }] }, { text: '' }])
    expect(lastResults(id, 1)[0]).toMatchObject({ stdout: 'cc c.c\n' })

    // With wait it returns when the job ends, not at the timeout.
    setTimeout(() => finishBoxJob(id, 'make all', { stdout: 'done\n', exitCode: 2 }), 400)
    const waitedFrom = Date.now()
    await say(id, 'wait', [{ calls: [{ name: 'job_output', args: { job_id: jobId, wait: true, timeout_seconds: 20 } }] }, { text: '' }])
    expect(lastResults(id, 1)[0]).toMatchObject({ jobId, status: 'completed', exitCode: 2, stdout: 'done\n' })
    expect(Date.now() - waitedFrom).toBeLessThan(10_000)
  })

  it('job_output with a short wait returns still running when the job does not end', async () => {
    const id = await robot()
    holdBoxJob(id, 'sleep 3600')
    await say(id, 'sleep', [{ calls: [run('sleep 3600', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    await say(id, 'wait', [{ calls: [{ name: 'job_output', args: { job_id: jobId, wait: true, timeout_seconds: 1 } }] }, { text: '' }])
    expect(lastResults(id, 1)[0]).toMatchObject({ status: 'running', note: expect.stringContaining('still running') })
  })

  it('job_kill ends a job, keeps its output under spill/jobs/ and does not wake the Robot; an unknown job is refused', async () => {
    const id = await robot()
    holdBoxJob(id, 'tail -f log')
    await say(id, 'follow', [{ calls: [run('tail -f log', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    printBoxJob(id, 'tail -f log', 'line 1\n')
    await say(id, 'stop', [{ calls: [{ name: 'job_kill', args: { job_id: jobId } }, { name: 'job_kill', args: { job_id: 'j-nope' } }] }, { text: '' }])
    const [killed, unknown] = results(id).slice(-2)
    expect(JSON.parse(killed!)).toEqual({ jobId, status: 'killed' })
    expect(unknown).toContain('no job j-nope')
    expect(boxLog.get(id)).toContain(`kill ${jobId}`)
    expect(await workspaceText(id, `spill/jobs/${jobId}.log`)).toContain('line 1')
    expect((await panel(id)).box?.jobs).toBeUndefined()
    await tick(id)
    expect(wakes(id)).toEqual([])
  })
})

describe('a finished job wakes the Robot (gb-pptr)', () => {
  it('as a follow-up with its id, exit code and the last 40 lines; the whole log is under spill/jobs/', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 report.py')
    await say(id, 'run it', [{ calls: [run('python3 report.py', { run_in_background: true })] }, { text: 'Started.' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    const lines = Array.from({ length: 120 }, (_, index) => `row ${index + 1}`).join('\n') + '\n'
    finishBoxJob(id, 'python3 report.py', { stdout: lines, stderr: 'warning: slow disk\n', exitCode: 0 })
    scripts.set(id, [{ calls: [{ name: 'say', args: { text: 'The report is done.' } }] }, { text: '' }])
    await tick(id)
    const [wake] = wakes(id)
    expect(wake).toContain(`[Box job ${jobId} finished: exit 0]`)
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
    // It woke the Robot once; the next alarm adds nothing, and job_list shows the end.
    await tick(id)
    expect(wakes(id)).toHaveLength(1)
    await say(id, 'jobs?', [{ calls: [{ name: 'job_list', args: {} }] }, { text: '' }])
    expect(lastResults(id, 1)[0]!.jobs).toEqual([expect.objectContaining({ id: jobId, status: 'completed', exitCode: 0, log: `spill/jobs/${jobId}.log` })])
  })

  it('a failing exit code is told as it is', async () => {
    const id = await robot()
    holdBoxJob(id, 'make test')
    await say(id, 'run', [{ calls: [run('make test', { run_in_background: true })] }, { text: '' }])
    finishBoxJob(id, 'make test', { stderr: 'FAILED\n', exitCode: 2 })
    await tick(id)
    expect(wakes(id)[0]).toContain('finished: exit 2')
  })

  it('a job promoted from the foreground wakes the Robot too', async () => {
    const id = await robot()
    holdBoxJob(id, 'sleep 30 && echo ok')
    await say(id, 'go', [{ calls: [run('sleep 30 && echo ok', { timeout_seconds: 1 })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    finishBoxJob(id, 'sleep 30 && echo ok', { stdout: 'ok\n' })
    await tick(id)
    expect(wakes(id)[0]).toContain(`[Box job ${jobId} finished: exit 0]`)
  })
})

describe('the Box stays up while a job runs (gb-5bfw, gb-aafm)', () => {
  it('the Turn ends with the job running; the idle stop waits for the job and counts from its end', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 long.py')
    await say(id, 'start it', [{ calls: [run('python3 long.py', { run_in_background: true })] }, { text: 'Started; I will tell you when it is done.' }])
    expect((await env.ROBOT.getByName(id).conversation()).working).toBe(false)
    // Twenty minutes with no command: a Box without a job would have stopped.
    await testRobot(id).backdateBoxForTest(20 * MINUTE)
    await tick(id)
    expect(boxLog.get(id)).not.toContain('stop')
    expect((await panel(id)).box?.state).toBe('running')
    // The alarm looks at the job on its own schedule: no stop is due, a look is.
    const next = await testRobot(id).alarmForTest()
    expect(next).toBeLessThanOrEqual(Date.now() + 16_000)

    finishBoxJob(id, 'python3 long.py')
    scripts.set(id, [{ text: '' }])
    await tick(id)
    // The job ended just now: the ten minutes count from here.
    expect(boxLog.get(id)).not.toContain('stop')
    const due = await testRobot(id).alarmForTest()
    expect(due).toBeGreaterThan(Date.now() + 9 * MINUTE)
    await testRobot(id).backdateBoxForTest(11 * MINUTE)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await vi.waitFor(() => expect(boxLog.get(id)!.at(-1)).toBe('stop'), { timeout: 10_000 })
  })

  it('a Box lost under a running job marks it lost and wakes the Robot as failed', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 long.py')
    await say(id, 'start it', [{ calls: [run('python3 long.py', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    loseBoxJobs(id)
    scripts.set(id, [{ text: '' }])
    await tick(id)
    expect(wakes(id)[0]).toContain(`[Box job ${jobId} failed: the Box was lost while it ran]`)
    await say(id, 'jobs?', [{ calls: [{ name: 'job_list', args: {} }] }, { text: '' }])
    expect(lastResults(id, 1)[0]!.jobs).toEqual([expect.objectContaining({ id: jobId, status: 'lost', exitCode: null })])
    expect((await panel(id)).box?.jobs).toBeUndefined()
  })

  it('stopping the Box from the panel ends its jobs with the output so far and tells the Robot', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 long.py')
    await say(id, 'start it', [{ calls: [run('python3 long.py', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    printBoxJob(id, 'python3 long.py', 'step 1\n')
    scripts.set(id, [{ text: '' }])
    expect((await api(ANNA, `/api/robots/${id}/box/stop`, { body: {} })).status).toBe(200)
    await settle(id)
    expect(wakes(id)[0]).toContain(`[Box job ${jobId} failed: the Box was stopped]`)
    expect(wakes(id)[0]).toContain('step 1')
    expect(await workspaceText(id, `spill/jobs/${jobId}.log`)).toContain('step 1')
    // Read after the Box stopped, a job points to its log.
    await say(id, 'read', [{ calls: [{ name: 'job_output', args: { job_id: jobId } }] }, { text: '' }])
    expect(lastResults(id, 1)[0]!.note).toContain(`spill/jobs/${jobId}.log`)
  })

  it('the owner stops one job from the panel; the Robot is told and the job is gone from the section', async () => {
    const id = await robot()
    holdBoxJob(id, 'python3 long.py')
    await say(id, 'start it', [{ calls: [run('python3 long.py', { run_in_background: true })] }, { text: '' }])
    const jobId = lastResults(id, 1)[0]!.jobId as string
    expect((await panel(id)).box?.jobs).toEqual([expect.objectContaining({ id: jobId, command: 'python3 long.py' })])
    scripts.set(id, [{ text: '' }])
    const stopped = await api<{ status: string }>(ANNA, `/api/robots/${id}/box/jobs/${jobId}/stop`, { body: {} })
    expect(stopped.body).toMatchObject({ jobId, status: 'killed' })
    await settle(id)
    expect(wakes(id)[0]).toContain(`[Box job ${jobId} was stopped by Anna]`)
    expect((await panel(id)).box?.jobs).toBeUndefined()
    expect((await api(ANNA, `/api/robots/${id}/box/jobs/${jobId}/stop`, { body: {} })).status).toBe(200)
  })
})
