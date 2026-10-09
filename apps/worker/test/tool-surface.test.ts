/**
 * The tool surface contract (v1.8): every tool a Robot sees throws on failure, returns JSON, validates its
 * inputs before any call, is described in the Glossary's words and reaches code mode with typed parameters.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { jsonSchemaToTs } from '@deepseek-ai/dsh-tools'
import type { RobotSummary } from '@mr-robot/protocol'
import { TOOL_GROUP_NAMES } from '../src/agent/catalog.ts'
import { CONNECTOR_PLUGINS } from '../src/connectors/registry.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { account, testHost } from './connector-host.ts'
import { connectorFixtures } from './connector-fixtures.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  connectorFixtures.reset()
  await stubModels()
  annaId = (await api<{ id: string }>(ANNA, '/api/me')).body.id
})

async function robotWith(grants: { tools?: string[]; connections?: string[] }): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: grants.tools ?? [], skills: [], recipients: [], secrets: [], connections: grants.connections ?? [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function say(id: string, calls: Array<{ name: string; args: Record<string, unknown> }>): Promise<string[]> {
  scripts.set(id, [...calls.map((call) => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'go' } })
  await settle(id)
  const last = requests.get(id)!.at(-1)!
  return last.messages.filter((message) => message.role === 'tool').map((message) => message.content.map((block) => ('text' in block ? block.text : '')).join(''))
}

const lastTools = (id: string) => requests.get(id)!.at(-1)!.tools ?? []

describe('input validation before any call (ts-6z2k, ts-lnox, ts-nivs, ts-yf1d)', () => {
  it('delete_file on a missing file fails instead of reporting a deletion (ts-6z2k)', async () => {
    const id = await robotWith({ tools: ['files'] })
    const [missing, existing, deleted] = await say(id, [
      { name: 'delete_file', args: { path: 'notes/nope.md' } },
      { name: 'write', args: { file_path: 'notes/a.md', content: 'a' } },
      { name: 'delete_file', args: { path: 'notes/a.md' } },
    ])
    expect(missing).toContain('No file "notes/nope.md" in your Workspace')
    expect(missing).not.toContain('"deleted"')
    expect(existing).toBeDefined()
    expect(JSON.parse(deleted!)).toEqual({ deleted: 'notes/a.md' })
  })

  it('glob and grep return arrays (ts-uy4d)', async () => {
    const id = await robotWith({ tools: ['files'] })
    const results = await say(id, [
      { name: 'write', args: { file_path: 'notes/a.md', content: 'alpha\nbeta' } },
      { name: 'glob', args: { pattern: 'notes/**' } },
      { name: 'grep', args: { pattern: 'beta' } },
      { name: 'glob', args: { pattern: 'nothing/**' } },
    ])
    expect(JSON.parse(results[1]!)).toEqual(['notes/a.md'])
    expect(JSON.parse(results[2]!)).toEqual([{ path: 'notes/a.md', line: 2, text: 'beta' }])
    expect(JSON.parse(results[3]!)).toEqual([])
  })

  it('schedule_create refuses after_seconds under 60 as it does every_seconds, in Routine words (ts-lnox, ts-x0kl)', async () => {
    const id = await robotWith({ tools: ['routines'] })
    const [after, every, fine] = await say(id, [
      { name: 'schedule_create', args: { title: 'Soon', prompt: 'ping', after_seconds: 5 } },
      { name: 'schedule_create', args: { title: 'Often', prompt: 'ping', every_seconds: 5 } },
      { name: 'schedule_create', args: { title: 'Later', prompt: 'ping', after_seconds: 120 } },
    ])
    expect(after).toContain('after_seconds must be at least 60')
    expect(every).toContain('every_seconds must be at least 60')
    expect(fine).not.toContain('must be at least')
    const [both] = await say(id, [{ name: 'schedule_create', args: { title: 'Two', prompt: 'ping', after_seconds: 120, every_seconds: 120 } }])
    expect(both).toContain('Routine')
    expect(both).not.toMatch(/reminder/i)
  })

  it('robot_directory without recipients is an empty list with a hint (ts-nivs)', async () => {
    const id = await robotWith({ tools: ['messaging'] })
    const [result] = await say(id, [{ name: 'robot_directory', args: {} }])
    expect(JSON.parse(result!)).toEqual({ robots: [], hint: expect.stringContaining('propose_grants') })
  })

  it('exa_agent_list_events without an id names the parameter and calls no service (ts-yf1d)', async () => {
    const id = await robotWith({ tools: ['exa-agent'] })
    const [result] = await say(id, [{ name: 'exa_agent_list_events', args: {} }])
    expect(result).toContain('parameter "id" is required')
    const blank = (await say(id, [{ name: 'exa_agent_get_run', args: { id: '  ' } }])).at(-1)
    expect(blank).toContain('parameter "id" is required and must not be empty')
  })
})

describe("the platform prompt names the shared-file tool a Robot has (ts-uldn)", () => {
  const platform = async (id: string) => (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text

  it("Mr. Robot's prompt says memory_write_shared, an ordinary Robot's says propose_member_file_edit", async () => {
    const mr = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
    await settle(mr)
    const mine = await robotWith({})
    const forMr = await platform(mr)
    expect(forMr).toContain('memory_write_shared')
    expect(forMr).not.toContain('propose_member_file_edit')
    const forOther = await platform(mine)
    expect(forOther).toContain('propose_member_file_edit')
    expect(forOther).not.toContain('memory_write_shared')
  })
})

describe('the mounted tool list of a fully granted Robot (ts-2zf7, ts-6b3k, ts-pg3q, ts-hhdz, ts-x0kl, ts-zd12, ts-h8oy)', () => {
  it('describes every tool and parameter, types every parameter for code mode, and offers no generic web_search', async () => {
    const connections: string[] = []
    for (const [kind, label, address, services] of [['google', 'Private', 'anna@gmail.test', ['gmail', 'gmail-send', 'calendar', 'drive']], ['slack', 'Acme', 'acme.slack.com', []], ['discord', 'Bot', 'mr-robot', []]] as const) {
      const connection = await env.MEMBER.getByName(annaId).addConnection({ kind, label, account: address, services: [...services], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { accessToken: 'a', refreshToken: 'r', token: 't', cookie: 'c' } })
      connections.push(connection.id, `${connection.id}:write`)
    }
    const id = await robotWith({ tools: [...TOOL_GROUP_NAMES], connections })
    await say(id, [])
    const offered = lastTools(id)
    const names = offered.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['web_fetch', 'web_search_exa', 'schedule_create', 'drive_replace', 'browser_wait', 'discord_accounts']))
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('drive_import')

    const problems: string[] = []
    for (const tool of offered) {
      if (tool.description.trim() === '') problems.push(`${tool.name}: no description`)
      const schema = tool.parameters as { properties?: Record<string, { description?: string }> }
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        if ((property.description ?? '').trim() === '') problems.push(`${tool.name}.${name}: no description`)
      }
      if (jsonSchemaToTs(tool.parameters).includes('unknown')) problems.push(`${tool.name}: parameters are unknown in the SDK`)
    }
    if (process.env['LIST']) throw new Error(problems.join('\n'))
    expect(problems).toEqual([])

    const describedAs = (name: string) => offered.find((tool) => tool.name === name)!.description
    expect(describedAs('web_fetch')).toContain('web_search_exa')
    expect(describedAs('web_fetch')).toContain('statusCode')
    for (const tool of offered.filter((entry) => entry.name.startsWith('schedule_'))) expect(tool.description + JSON.stringify(tool.parameters)).not.toMatch(/reminder/i)
    expect(describedAs('browser_wait')).toMatch(/page title/)
    expect(describedAs('browser_wait')).toMatch(/30 000/)
    expect(describedAs('drive_replace')).toContain('Overwrite')
  })
})

describe('a simulated failure rejects in every connector tool (ts-jbep, ts-2zf7)', () => {
  it.each([['google', ['gmail', 'gmail-send', 'calendar', 'drive']], ['slack', []], ['discord', []]] as const)('%s', async (kind, services) => {
    const plugin = CONNECTOR_PLUGINS[kind]!
    const { host } = testHost(kind, [account(kind, 'Main', 'main@test', [...services], true)])
    const sample = (property: { type?: string; enum?: unknown[] }): unknown =>
      property.enum !== undefined ? property.enum[0] : property.type === 'array' ? ['x'] : property.type === 'number' || property.type === 'integer' ? 1 : property.type === 'boolean' ? true : property.type === 'object' ? {} : 'x'
    const tools = plugin.tools(host)
    expect(tools.length).toBeGreaterThan(5)
    for (const tool of tools) {
      const schema = tool.parameters as { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] }
      const args = Object.fromEntries((schema.required ?? []).map((name) => [name, sample(schema.properties![name]!)]))
      await expect(tool.execute(args as never, {} as never), tool.name).rejects.toThrow()
    }
  })
})
