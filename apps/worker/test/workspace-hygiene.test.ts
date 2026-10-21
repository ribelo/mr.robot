import { env, reset, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, RobotPanel, WorkspaceFileView } from '@mr-robot/protocol'
import { screenName, SCREEN_KEEP_MS } from '../src/workspace/screens.ts'
import { RETIRED_ROBOT_FILES, ROBOT_FILES } from '../src/workspace/templates.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const DAY = 24 * 60 * 60_000

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

async function activeRobot(): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['files', 'tasks'], skills: [], recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, text: string, script: Parameters<typeof scripts.set>[1]) {
  scripts.set(id, [...script])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const keysUnder = async (prefix: string) => (await env.FILES.list({ prefix })).objects.map((object) => object.key)
const fileText = async (id: string, path: string) => (await api<{ text: string }>(ANNA, `/api/robots/${id}/file?path=${encodeURIComponent(path)}`)).body.text
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 5, 0, 0, 0, 3, 32, 0, 255])

describe('memory/bank is gone (sk-vhlb)', () => {
  it('a new Robot has no memory/bank; untouched old templates are removed at the next Turn, a file the Robot wrote into stays', async () => {
    const id = await activeRobot()
    expect(Object.keys(ROBOT_FILES).some((path) => path.startsWith('memory/bank/'))).toBe(false)
    expect(await keysUnder(`robots/${id}/memory/bank/`)).toEqual([])

    for (const [path, text] of Object.entries(RETIRED_ROBOT_FILES)) await env.FILES.put(`robots/${id}/${path}`, path.endsWith('experience.md') ? text + '- Learned that the shop closes at 18:00.\n' : text)
    await testRobot(id).forgetBankMigrationForTest()
    await say(id, 'hello again', [{ text: 'Hi.' }])

    expect(await keysUnder(`robots/${id}/memory/bank/`)).toEqual([`robots/${id}/memory/bank/experience.md`])
    expect(await fileText(id, 'memory/bank/experience.md')).toContain('shop closes at 18:00')
  })
})

describe('screenshots live outside the Workspace (sk-m7t1)', () => {
  it('are stored under the Robot system prefix, not listed in Files, and still served to the chat and the panel', async () => {
    const id = await activeRobot()
    await testRobot(id).saveScreenForTest()
    expect(await keysUnder(`robots/${id}/`)).not.toContainEqual(expect.stringContaining('screen'))
    const stored = await keysUnder(`screens/${id}/`)
    expect(stored).toHaveLength(1)

    const files = (await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body
    expect(files.some((file) => file.group === 'screens' || file.path.includes('screens'))).toBe(false)

    const thumbnail = await SELF.fetch(`https://robot.test/api/robots/${id}/screen`, { headers: { 'x-dev-identity': ANNA } })
    expect(thumbnail.status).toBe(200)
    expect((await thumbnail.arrayBuffer()).byteLength).toBe(png.length)
    const name = stored[0]!.slice(`screens/${id}/`.length)
    const attachment = await SELF.fetch(`https://robot.test/api/robots/${id}/attachments/${encodeURIComponent(`screen:${name}`)}`, { headers: { 'x-dev-identity': ANNA } })
    expect(attachment.status).toBe(200)
    expect(attachment.headers.get('content-type')).toBe('image/png')
  })

  it('an older screenshot saved in the Workspace is still served by the image route', async () => {
    const id = await activeRobot()
    const name = screenName(Date.now() - DAY)
    await env.FILES.put(`robots/${id}/screens/${name}`, png, { httpMetadata: { contentType: 'image/png' } })
    const attachment = await SELF.fetch(`https://robot.test/api/robots/${id}/attachments/${encodeURIComponent(`screen:${name}`)}`, { headers: { 'x-dev-identity': ANNA } })
    expect(attachment.status).toBe(200)
    expect((await attachment.arrayBuffer()).byteLength).toBe(png.length)
  })

  it('the alarm sweeps those older than 7 days, in both places, at most once a day', async () => {
    const id = await activeRobot()
    await testRobot(id).saveScreenForTest()
    const now = Date.now()
    const old = screenName(now - SCREEN_KEEP_MS - DAY)
    const recent = screenName(now - 6 * DAY)
    await env.FILES.put(`screens/${id}/${old}`, png)
    await env.FILES.put(`screens/${id}/${recent}`, png)
    await env.FILES.put(`robots/${id}/screens/${old}`, png)
    await env.FILES.put(`robots/${id}/screens/notes.md`, 'my own file')

    await testRobot(id).sweepDueForTest()
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await vi.waitFor(async () => expect(await keysUnder(`screens/${id}/`)).toHaveLength(2))
    const left = [...(await keysUnder(`screens/${id}/`)), ...(await keysUnder(`robots/${id}/screens/`))]
    expect(left).toContain(`screens/${id}/${recent}`)
    expect(left).toContain(`robots/${id}/screens/notes.md`)
    expect(left.filter((key) => key.endsWith(old))).toEqual([])
    expect(left).toHaveLength(3)

    // The next sweep is a day away: an alarm now leaves a newly old object alone.
    const next = (await testRobot(id).sweepNextForTest())!
    expect(next).toBeGreaterThan(Date.now() + DAY - 60_000)
    await env.FILES.put(`screens/${id}/${old}`, png)
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    expect(await keysUnder(`screens/${id}/`)).toContainEqual(`screens/${id}/${old}`)
  })
})

describe('Clear history and Start over (sk-8won)', () => {
  it('Clear history keeps every file; Start over resets the Workspace to templates and keeps Grants, Tasks and settings', async () => {
    const id = await activeRobot()
    await api(ANNA, `/api/robots/${id}/file?path=MEMORY.md`, { method: 'PUT', body: { content: '# MEMORY.md\nPays on the 10th.' } })
    await say(id, 'set up', [
      { calls: [{ name: 'write', args: { on: 'workspace', file_path: 'out/report.md', content: 'quarterly' } }, { name: 'task_create', args: { title: 'Taxes', instructions: 'Check taxes.', assignee: 'self', timing: { kind: 'recurring', daily: { time: '09:00' } } } }] },
      { text: 'Done.' },
    ])
    await testRobot(id).saveScreenForTest()
    await env.FILES.put(`robots/${id}/memory/bank/experience.md`, 'mine')
    const name = 'New robot'

    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: 'Wrong' } })).status).toBe(400)
    expect((await api(ANNA, `/api/robots/${id}/clear`, { body: { confirm: name } })).status).toBe(200)
    expect(await fileText(id, 'MEMORY.md')).toContain('Pays on the 10th.')
    expect(await fileText(id, 'out/report.md')).toBe('quarterly')

    const grantsBefore = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.grants
    expect((await api(ANNA, `/api/robots/${id}/start-over`, { body: { confirm: 'Wrong' } })).status).toBe(400)
    expect(await fileText(id, 'out/report.md')).toBe('quarterly')
    expect((await api(ANNA, `/api/robots/${id}/start-over`, { body: { confirm: name } })).status).toBe(200)

    const keys = (await keysUnder(`robots/${id}/`)).map((key) => key.slice(`robots/${id}/`.length)).sort()
    expect(keys).toEqual(Object.keys(ROBOT_FILES).sort())
    expect(await fileText(id, 'MEMORY.md')).toBe(ROBOT_FILES['MEMORY.md'])
    expect(await keysUnder(`screens/${id}/`)).toEqual([])
    const panel = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body
    expect(panel.settings.grants).toEqual(grantsBefore)
    expect(panel.settings.identity.name).toBe(name)
    expect(panel.tasks.map((task) => task.title)).toEqual(['Taxes'])
    expect(panel.screen).toBeNull()
    const items = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items
    expect(items.filter((item) => item.kind === 'message' || item.kind === 'reply')).toEqual([])
    // The product docs are served from the bundle: Start over cannot lose them.
    expect((await api<WorkspaceFileView[]>(ANNA, `/api/robots/${id}/files`)).body.some((file) => file.path === 'docs/robots.md')).toBe(true)
    // The Robot still works.
    await say(id, 'back again', [{ text: 'Fresh start.' }])
  })
})

describe('orphans (sk-44d5)', () => {
  it('a registry row with status deleted and an empty Robot lose their files once, and the row goes', async () => {
    const orphan = 'r-orphan-before-v1.3'
    await env.FILES.put(`robots/${orphan}/MEMORY.md`, 'left behind')
    await env.FILES.put(`robots/${orphan}/out/report.md`, 'left behind')
    await env.FILES.put(`screens/${orphan}/${screenName(Date.now())}`, png)
    const space = env.SPACE.getByName('space')
    const mr = (await api<Array<{ id: string }>>(ANNA, '/api/robots')).body[0]!.id
    await runInDurableObject(space, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO robot (id, owner_id, kind, identity, sharing, status, fleet_state, last_line, last_at) VALUES (?, 'm-gone', 'robot', '{}', 'private', 'deleted', 'sleeping', '', 0)", orphan,
      )
      state.storage.sql.exec("DELETE FROM setting WHERE k = 'orphans-destroyed-v1.11'")
    })
    // The Robot's own storage is empty: it knows nothing of the id it is asked to destroy.
    expect(await testRobot(orphan).toolNames().catch(() => 'empty')).toBe('empty')

    await space.destroyOrphans()

    expect(await keysUnder(`robots/${orphan}/`)).toEqual([])
    expect(await keysUnder(`screens/${orphan}/`)).toEqual([])
    const rows = await runInDurableObject(space, async (_instance, state) => state.storage.sql.exec("SELECT id FROM robot WHERE status = 'deleted'").toArray())
    expect(rows).toEqual([])
    // Live Robots are not touched, and the pass does not run twice.
    expect((await api<Array<{ id: string }>>(ANNA, '/api/robots')).body.some((entry) => entry.id === mr)).toBe(true)
    await env.FILES.put(`robots/${orphan}/MEMORY.md`, 'new')
    await runInDurableObject(space, async (_instance, state) => {
      state.storage.sql.exec("INSERT INTO robot (id, owner_id, kind, identity, sharing, status, fleet_state, last_line, last_at) VALUES (?, 'm-gone', 'robot', '{}', 'private', 'deleted', 'sleeping', '', 0)", orphan)
    })
    await space.destroyOrphans()
    expect(await keysUnder(`robots/${orphan}/`)).toHaveLength(1)
  })
})
