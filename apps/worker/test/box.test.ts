/**
 * A Box (v1.14 ticket 10, the Computer until v1.15) against the stub backend: the grant, the tools, boot with box/ and setup.sh,
 * sync back at Turn end, the idle stop, the running time as cost, and Auto review of commands.
 */
import { env, reset, runDurableObjectAlarm } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { RobotPanel } from '@mr-robot/protocol'
import { REVIEW_POLICY } from '../src/agent/auto-review.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { boxDisks, boxLog, boxScripts } from './stub-box.ts'
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
    expect(requests.get(without)![0]!.tools!.map((tool) => tool.name)).not.toContain('box_run')
    expect((await panel(without)).box).toBeUndefined()
    const granted = await robotWith({ box: 'allow' })
    await say(granted, 'hi', [{ text: 'Hi.' }])
    expect(requests.get(granted)![0]!.tools!.map((tool) => tool.name)).toEqual(expect.arrayContaining(['box_run', 'box_read', 'box_write']))
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
      { calls: [{ name: 'box_run', args: { command: 'python3 sum.py' } }, { name: 'box_run', args: { command: 'false' } }, { name: 'box_run', args: { command: 'seq 1 5000' } }] },
      { calls: [{ name: 'box_write', args: { path: '/workspace/box/notes.md', content: 'kept' } }, { name: 'box_write', args: { path: 'scratch.txt', content: 'gone' } }, { name: 'box_read', args: { path: 'box/data.csv' } }] },
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

  it('stops ten minutes after the last command, bills its time, and boots again on the next command', async () => {
    const id = await robotWith({ box: 'allow' })
    await say(id, 'run it', [{ calls: [{ name: 'box_run', args: { command: 'echo hi' } }] }, { text: 'Done.' }])
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
    await say(id, 'again', [{ calls: [{ name: 'box_run', args: { command: 'echo again' } }] }, { text: 'Done.' }])
    expect(boxLog.get(id)!.filter((entry) => entry === 'boot')).toHaveLength(2)
  })

  it('its running time counts toward the spend limit; the owner stops it from the panel', async () => {
    await api(ANNA, '/api/admin/settings', { method: 'PATCH', body: { robotSpendLimit: { kind: 'usd', amount: 1 } } })
    const id = await robotWith({ box: 'allow' })
    await say(id, 'run it', [{ calls: [{ name: 'box_run', args: { command: 'echo hi' } }] }, { text: 'Done.' }])
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
    expect(requests.get(id)![0]!.tools!.map((tool) => tool.name)).toEqual(expect.arrayContaining(['box_run']))
  })

  it('with Auto review on, box_run is reviewed before it runs', async () => {
    const id = await robotWith({ box: 'allow' }, { autoReview: true })
    await say(id, 'delete everything', [
      { calls: [{ name: 'box_run', args: { command: 'rm -rf /workspace/box' } }] },
      { text: '{"risk":"medium","decision":"deny","reason":"deletes kept files the owner did not name"}' },
      { text: 'Waiting for you.' },
    ])
    expect((requests.get(id) ?? []).filter((request) => request.system === REVIEW_POLICY)).toHaveLength(1)
    expect(boxLog.get(id) ?? []).toEqual([])
  })
})
