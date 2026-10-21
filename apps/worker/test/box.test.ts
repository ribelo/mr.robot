/**
 * A Box (v1.14 ticket 10, the Computer until v1.15) against the stub backend: the grant, the tools, boot with box/ and setup.sh,
 * sync back at Turn end, the idle stop, the running time as cost, and Auto review of commands.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { RobotPanel, RobotSummary } from '@mr-robot/protocol'
import { REVIEW_POLICY } from '../src/agent/auto-review.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { boxDisks, boxLog, boxScripts, finishBoxJob, holdBoxJob, holdBoxRun, releaseBoxRun, StubBox } from './stub-box.ts'
import { requests, scripts, type StubReply } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const MINUTE = 60_000

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  boxLog.clear()
  boxDisks.clear()
  boxScripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function robotWith(tools: Record<string, string>, settings: Record<string, unknown> = {}): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, contextBudget: 32_000, grants: { tools }, ...settings } })
  await testRobot(body.id).activateForTest()
  requests.delete(body.id)
  return body.id
}

async function say(id: string, text: string, script: StubReply[]): Promise<void> {
  scripts.set(id, script)
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
const results = (request: GenerateOptions) => request.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
const workspaceText = async (id: string, path: string) => (await (await env.FILES.get(`robots/${id}/${path}`))?.text()) ?? null

describe('the Box (ao-8x0c, ao-xokp, ao-7ptt, ao-ia4z, ao-joux, ao-54j2, ao-7lcd)', () => {
  it('its tools exist only with the box grant', async () => {
    const without = await robotWith({ files: 'allow' })
    await say(without, 'hi', [{ text: 'Hi.' }])
    expect(requests.get(without)![0]!.tools!.map((tool) => tool.name)).not.toContain('run')
    expect((await panel(without)).box).toBeUndefined()
    const granted = await robotWith({ box: 'allow' })
    await say(granted, 'hi', [{ text: 'Hi.' }])
    expect(requests.get(granted)![0]!.tools!.map((tool) => tool.name)).toEqual(expect.arrayContaining(['run', 'read', 'write']))
    expect((await panel(granted)).box).toEqual({ state: 'off', since: null, lastCommandAt: null })
  })

  it('boots with box/ copied in and setup.sh run; returns output and exit code; spills long output; syncs box/ back at Turn end', async () => {
    const id = await robotWith({ box: 'allow', files: 'allow' })
    await env.FILES.put(`robots/${id}/box/setup.sh`, 'pip3 install requests\n')
    await env.FILES.put(`robots/${id}/box/data.csv`, 'a,b\n1,2\n')
    boxScripts.set(id, (command, disk) => {
      if (command === 'python3 sum.py') {
        disk.write('/workspace/box/result.txt', 'sum: 3\n')
        return { stdout: 'sum: 3\n' }
      }
      if (command === 'false') return { stdout: '', stderr: 'failed', exitCode: 1 }
      if (command === 'seq 1 5000') return { stdout: Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`).join('\n') }
      return undefined
    })
    await say(id, 'add it up', [
      { calls: [{ name: 'run', args: { on: 'box', command: 'python3 sum.py' } }, { name: 'run', args: { on: 'box', command: 'false' } }, { name: 'run', args: { on: 'box', command: 'seq 1 5000' } }] },
      { calls: [{ name: 'write', args: { on: 'box', file_path: '/workspace/box/notes.md', content: 'kept' } }, { name: 'write', args: { on: 'box', file_path: 'scratch.txt', content: 'gone' } }, { name: 'read', args: { on: 'box', file_path: 'box/data.csv' } }] },
      { text: 'The sum is 3.' },
    ])
    const log = boxLog.get(id)!
    expect(log.slice(0, 2)).toEqual(['boot', 'run /workspace/box: bash setup.sh'])
    const [sum, failed, long] = results(requests.get(id)![1]!)
    expect(JSON.parse(sum!)).toEqual({ kind: 'foreground', stdout: 'sum: 3\n', stderr: '', exitCode: 0 })
    expect(JSON.parse(failed!)).toMatchObject({ exitCode: 1, stderr: 'failed' })
    expect(long).toContain('Full formatted result stored at: /workspace/spill/')
    expect(results(requests.get(id)![2]!).at(-1)).toContain('a,b')
    // The Turn ended: what it kept under /workspace/box is in the Workspace; scratch is not.
    expect(await workspaceText(id, 'box/result.txt')).toBe('sum: 3\n')
    expect(await workspaceText(id, 'box/notes.md')).toBe('kept')
    expect(await workspaceText(id, 'scratch.txt')).toBeNull()
    expect((await panel(id)).box).toMatchObject({ state: 'running' })
  })

  it('parallel calls on a cold Box boot it once: setup.sh runs once and ws works with the token the boot wrote (deep review P9)', async () => {
    const id = await robotWith({ box: 'allow', files: 'allow' })
    await env.FILES.put(`robots/${id}/box/setup.sh`, 'pip3 install requests\n')
    await env.FILES.put(`robots/${id}/box/data.csv`, 'a,b\n1,2\n')
    await say(id, 'read them', [
      { calls: [1, 2, 3].map(() => ({ name: 'read', args: { on: 'box', file_path: 'box/data.csv' } })) },
      { calls: [{ name: 'run', args: { on: 'box', command: 'ws get box/data.csv copy.csv' } }] },
      { text: 'Done.' },
    ])
    expect(results(requests.get(id)![1]!).filter((text) => text.includes('a,b'))).toHaveLength(3)
    expect(boxLog.get(id)!.filter((entry) => entry.endsWith('bash setup.sh'))).toHaveLength(1)
    expect(JSON.parse(results(requests.get(id)![2]!).at(-1)!)).toMatchObject({ exitCode: 0 })
    expect(boxDisks.get(id)!.get('/workspace/copy.csv')).toBeDefined()
  })

  it('a Stop pressed while the Box boots waits for the boot, and the Box ends stopped (deep review P9b)', async () => {
    const id = await robotWith({ box: 'allow', files: 'allow' })
    await env.FILES.put(`robots/${id}/box/setup.sh`, 'pip3 install requests\n')
    holdBoxRun(id, 'bash setup.sh')
    scripts.set(id, [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo hi' } }] }, { text: 'Done.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'run it' } })
    await vi.waitFor(() => expect(boxLog.get(id)).toContain('run /workspace/box: bash setup.sh'), { timeout: 10_000 })
    expect((await panel(id)).box?.state).toBe('booting')
    const stop = api(ANNA, `/api/robots/${id}/box/stop`, { body: {} })
    // The Stop has reached the Robot while setup.sh still runs.
    await new Promise((resolve) => setTimeout(resolve, 200))
    releaseBoxRun(id, 'bash setup.sh')
    expect((await stop).status).toBe(200)
    await settle(id)
    expect((await panel(id)).box?.state).toBe('off')
    expect(boxLog.get(id)!.at(-1)).toBe('stop')
    expect(await new StubBox(id).running()).toBe(false)
  })

  it('stops ten minutes after the last command, bills its time, and boots again on the next command', async () => {
    const id = await robotWith({ box: 'allow' })
    await say(id, 'run it', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo hi' } }] }, { text: 'Done.' }])
    const due = await testRobot(id).alarmForTest()
    expect(due).toBeLessThanOrEqual(Date.now() + 10 * MINUTE)
    // Nine minutes on: nothing stops.
    await testRobot(id).backdateBoxForTest(9 * MINUTE)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    expect((await panel(id)).box?.state).toBe('running')
    await testRobot(id).backdateBoxForTest(2 * MINUTE)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    // The alarm may already have fired by itself: its work is what counts.
    await vi.waitFor(() => expect(boxLog.get(id)!.at(-1)).toBe('stop'), { timeout: 10_000 })
    await settle(id)
    const stopped = await panel(id)
    expect(stopped.box?.state).toBe('off')
    expect(stopped.usage.breakdown.box).toBeGreaterThan(0)
    expect(stopped.usage.boxMinutes).toBeGreaterThanOrEqual(10)
    await say(id, 'again', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo again' } }] }, { text: 'Done.' }])
    expect(boxLog.get(id)!.filter((entry) => entry === 'boot')).toHaveLength(2)
  })

  it('its running time counts toward the spend limit; the owner stops it from the panel', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { robotSpendLimit: { kind: 'usd', amount: 1 } } })
    const id = await robotWith({ box: 'allow' })
    await say(id, 'run it', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo hi' } }] }, { text: 'Done.' }])
    // Ten hours of running time at the container rate cross a dollar.
    await testRobot(id).backdateBoxForTest(600 * MINUTE)
    expect((await api(ANNA, `/api/robots/${id}/box/stop`, { body: {} })).status).toBe(200)
    const after = await panel(id)
    expect(after.box?.state).toBe('off')
    expect(after.usage.breakdown.box).toBeGreaterThan(1)
    expect(after.summary.status).toBe('blocked')
  })

  it('a Robot from a v1.14 deploy has its grant, cost rows, running time and computer/ folder under the new names (gb-ao8m)', async () => {
    const id = await robotWith({ files: 'allow' })
    await env.FILES.put(`robots/${id}/computer/setup.sh`, 'pip3 install requests\n')
    await env.FILES.put(`robots/${id}/computer/data.csv`, 'a,b\n1,2\n')
    await env.FILES.put(`robots/${id}/box/data.csv`, 'new\n')
    await testRobot(id).legacyComputerForTest()
    // The next Turn tidies the Workspace: the old folder moves, and a file already in box/ stays.
    await say(id, 'hi', [{ text: 'Hi.' }])
    const rows = await testRobot(id).boxRowsForTest()
    expect(rows.grants).toContain('box')
    expect(rows.grants).not.toContain('computer')
    expect(rows.usage).toEqual([{ month: '2026-09', source: 'box', costUsd: 0.5 }])
    expect(rows.running).toEqual([{ month: '2026-09', ms: 60000 }])
    expect(rows.oldTable).toBe(false)
    expect(await workspaceText(id, 'box/setup.sh')).toBe('pip3 install requests\n')
    expect(await workspaceText(id, 'box/data.csv')).toBe('new\n')
    expect(await workspaceText(id, 'computer/setup.sh')).toBeNull()
    expect(await workspaceText(id, 'computer/data.csv')).toBeNull()
    expect(requests.get(id)![0]!.tools!.map((tool) => tool.name)).toEqual(expect.arrayContaining(['run']))
  })

  it('keeps the uv and Bun caches whole as one archive: sent with ws at the stop, back before setup.sh at the next boot; a broken one is a cold cache (deep review P7)', async () => {
    // No files group: the caches are the platform's, and their ws runs with a permit.
    const id = await robotWith({ box: 'allow' })
    await env.FILES.put(`robots/${id}/box/setup.sh`, 'uv pip install pandas\n')
    const disk = () => boxDisks.get(id)!
    const wheel = '/workspace/box/.cache/uv/archive-v0/pandas/_libs.so'
    // Over the 20 MB a file of box/ goes back at: the very file the per-file sync used to leave out of the cache.
    const big = 'x'.repeat(21 * 1024 * 1024)
    let downloads = 0
    boxScripts.set(id, (command, stub) => {
      if (command === 'bash setup.sh') {
        if (stub.read(wheel) === undefined) {
          downloads++
          stub.write(wheel, big)
          for (let index = 0; index < 50; index++) stub.write(`/workspace/box/.cache/uv/archive-v0/pandas/file-${index}.py`, `# ${index}\n`)
        }
        return { stdout: 'installed' }
      }
      // tar and zstd, played: the archive holds the caches' files as JSON.
      const packTo = /-cf (\S+)/.exec(command)?.[1]
      if (packTo !== undefined) {
        const files = Object.fromEntries([...disk()].filter(([path]) => path.startsWith('/workspace/box/.cache/')).map(([path, file]) => [path, new TextDecoder().decode(file.bytes)]))
        stub.write(packTo, JSON.stringify(files))
        return { stdout: `packed ${disk().get(packTo)!.bytes.length}\n` }
      }
      const unpackFrom = /-xf (\S+)/.exec(command)?.[1]
      if (unpackFrom !== undefined) {
        try {
          for (const [path, text] of Object.entries(JSON.parse(stub.read(unpackFrom) ?? '') as Record<string, string>)) stub.write(path, text)
          return { stdout: '' }
        } catch {
          return { stdout: '', stderr: 'zstd: unsupported format', exitCode: 1 }
        }
      }
      return undefined
    })
    const boxKeys = async () => (await env.FILES.list({ prefix: `robots/${id}/box/` })).objects.map((object) => object.key.slice(`robots/${id}/`.length)).sort()
    const stop = async () => expect((await api(ANNA, `/api/robots/${id}/box/stop`, { body: {} })).status).toBe(200)
    const sinceLastBoot = () => boxLog.get(id)!.slice(boxLog.get(id)!.lastIndexOf('boot'))
    const ranAt = (log: string[], text: string) => log.findIndex((entry) => entry.includes(text))

    await say(id, 'install', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo up' } }] }, { text: 'Done.' }])
    expect(downloads).toBe(1)
    // The Turn ended and box/ was synced: not one file of the caches went back file by file.
    expect(await boxKeys()).toEqual(['box/setup.sh'])

    await stop()
    // The stop sent the caches as one file.
    expect(await boxKeys()).toEqual(['box/.cache.tar.zst', 'box/setup.sh'])

    await say(id, 'again', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo again' } }] }, { text: 'Done.' }])
    const booted = sinceLastBoot()
    // ws fetched the archive and it was unpacked before setup.sh, which found every package whole and downloaded nothing.
    expect(ranAt(booted, 'ws get box/.cache.tar.zst')).toBeGreaterThan(0)
    expect(ranAt(booted, '-xf ')).toBeGreaterThan(ranAt(booted, 'ws get box/.cache.tar.zst'))
    expect(ranAt(booted, 'bash setup.sh')).toBeGreaterThan(ranAt(booted, '-xf '))
    expect(downloads).toBe(1)
    expect(disk().get(wheel)?.bytes.length).toBe(big.length)
    expect(disk().has('/workspace/box/.cache.tar.zst')).toBe(false)

    // A broken archive: the Box boots with empty caches, and setup.sh fetches the packages again.
    await stop()
    await env.FILES.put(`robots/${id}/box/.cache.tar.zst`, 'not an archive')
    await say(id, 'once more', [{ calls: [{ name: 'run', args: { on: 'box', command: 'echo once more' } }] }, { text: 'Done.' }])
    expect(downloads).toBe(2)
    expect(ranAt(sinceLastBoot(), 'echo once more')).toBeGreaterThan(ranAt(sinceLastBoot(), 'bash setup.sh'))
  })

  it('with Auto review on, run on the Box is reviewed before it runs', async () => {
    const id = await robotWith({ box: 'allow' }, { autoReview: true })
    await say(id, 'delete everything', [
      { calls: [{ name: 'run', args: { on: 'box', command: 'rm -rf /workspace/box' } }] },
      { text: '{"risk":"medium","decision":"deny","reason":"deletes kept files the owner did not name"}' },
      { text: 'Waiting for you.' },
    ])
    expect((requests.get(id) ?? []).filter((request) => request.system === REVIEW_POLICY)).toHaveLength(1)
    expect(boxLog.get(id) ?? []).toEqual([])
  })
})

describe("the Fleet's running tool (v1.19, ec-es5g)", () => {
  it('names the command the Turn runs now, read from the tail of the live chapter', async () => {
    const id = await robotWith({ box: 'allow' })
    // A foreground command runs as a Job the tool waits for (or, at boot, as a plain run): both are held.
    holdBoxRun(id, 'make report')
    holdBoxJob(id, 'make report')
    scripts.set(id, [{ calls: [{ name: 'run', args: { on: 'box', command: 'make report' } }] }, { say: 'Made.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'make the report' } })
    const row = async () => (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((entry) => entry.id === id)!
    await vi.waitFor(async () => expect((await row()).turn?.activity).toBe('run'), { timeout: 10_000 })
    releaseBoxRun(id, 'make report')
    finishBoxJob(id, 'make report', { stdout: 'done' })
    await settle(id)
    expect((await row()).turn).toBeNull()
  })
})