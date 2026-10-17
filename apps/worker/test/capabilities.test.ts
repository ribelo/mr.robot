/**
 * The runtime section, my_capabilities and the time label of a Wake-up (v1.11 ticket 04): what a Robot
 * is told about itself, from the same list Advanced settings shows.
 */
import { env, reset, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CapabilitiesView, Conversation, GrantSet, Me, RobotPanel, RobotSummary, SettingsCatalog } from '@mr-robot/protocol'
import { docsIndex } from '../src/agent/docs-index.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const WARSAW = 'Europe/Warsaw'

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me', { headers: { 'X-Time-Zone': WARSAW } })
})

async function activeRobot(grants: Partial<GrantSet>, codeMode = false): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode, grants } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function mrRobot(): Promise<string> {
  const id = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.kind === 'mr-robot')!.id
  await settle(id)
  return id
}

/** A turn that ends after the Robot's tool calls. */
async function say(id: string, text: string, calls: Array<{ name: string; args: Record<string, unknown> }> = []): Promise<void> {
  scripts.set(id, [...calls.map((call) => ({ calls: [call] })), { text: 'Done.' }])
  await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

const lastRequest = (id: string) => requests.get(id)!.at(-1)!
const systemOf = (id: string) => JSON.stringify(lastRequest(id).system ?? lastRequest(id).messages.filter((message) => message.role === 'system'))

/** The text of the last tool result of the latest request. */
const lastToolResult = (id: string): string =>
  lastRequest(id).messages.filter((message) => message.role === 'tool').at(-1)!.content.map((block) => ('text' in block ? block.text : '')).join('')

/** A paired host of Anna's (HTTP pairing only). */
async function pairedHost(): Promise<string> {
  const start = await SELF.fetch('https://mr-robot.test/api/host/pair/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Desk', platform: 'linux' }) })
  const { code } = (await start.json()) as { code: string }
  await api(ANNA, `/api/hosts/pair/${code}`, { body: {} })
  return ((await (await SELF.fetch(`https://mr-robot.test/api/host/pair/poll?code=${code}`)).json()) as { hostId: string }).hostId
}

/** Anna owns a login, a Slack Connection (with write), a paired host and a second Robot to message. */
async function reachableThings(): Promise<void> {
  const annaId = (await api<{ id: string }>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/secrets/shop', { method: 'PUT', body: { username: 'anna', password: 'pw', websites: ['shop.test'], shared: false } })
  await env.MEMBER.getByName(annaId).addConnection({ kind: 'slack', label: 'Acme', account: 'acme.slack.com', services: [], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { cookie: 'c', token: 't' } })
  await pairedHost()
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
}

/** What Advanced settings lists for a Robot: the catalog's items and the levels in its settings, read from the API. */
async function settingsList(id: string): Promise<Array<{ kind: string; grant: string; description: string; level: string }>> {
  const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
  const grants = (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body.settings.grants
  const level = (levels: Record<string, string>, name: string) => levels[name] ?? 'deny'
  return [
    ...catalog.toolGroups.map((group) => ({ kind: 'tool group', grant: group.name, description: group.description, level: level(grants.tools, group.name) })),
    ...catalog.skills.map((skill) => ({ kind: 'skill', grant: skill.name, description: skill.description, level: level(grants.skills, skill.name) })),
    ...catalog.robots.map((robot) => ({ kind: 'recipient', grant: robot.id, description: 'A Robot you may message.', level: level(grants.recipients, robot.id) })),
    ...(catalog.connections ?? []).flatMap((connection) => [
      { kind: 'connection', grant: connection.id, description: expect.stringContaining('as this account') as unknown as string, level: level(grants.connections, connection.id) },
      ...(connection.kind === 'slack' ? [{ kind: 'connection', grant: `${connection.id}:write`, description: 'A separate grant: without it the Robot only reads', level: level(grants.connections, `${connection.id}:write`) }] : []),
    ]),
    ...(catalog.hosts ?? []).flatMap((host) => ['browser', 'files', 'shell'].map((facet) => ({ kind: 'host', grant: `${host.id}:${facet}`, description: expect.stringContaining('') as unknown as string, level: level(grants.hosts, `${host.id}:${facet}`) }))),
    ...catalog.secrets.map((secret) => ({ kind: 'login', grant: secret.name, description: expect.stringContaining('shop.test') as unknown as string, level: level(grants.secrets, secret.name) })),
  ]
}

/** What my_capabilities returns, flattened, with the level each group stands for. */
async function toolList(id: string): Promise<{ items: Array<{ kind: string; grant: string; description: string; level: string }>; view: CapabilitiesView }> {
  await say(id, 'what can you do?', [{ name: 'my_capabilities', args: {} }])
  const result = lastToolResult(id)
  expect(result.slice(0, 300)).toMatch(/^\{/)
  const view = JSON.parse(result) as CapabilitiesView
  const items = (['allow', 'ask', 'deny'] as const).flatMap((level) => view[level].map((entry) => ({ kind: entry.kind, grant: entry.grant, description: entry.description, level })))
  return { items, view }
}

const byKey = (list: Array<{ kind: string; grant: string }>) => [...list].sort((a, b) => `${a.kind}:${a.grant}`.localeCompare(`${b.kind}:${b.grant}`))

describe('my_capabilities (sk-e1hh, sk-ixvp)', () => {
  it("lists what Advanced settings lists, with the same levels and descriptions, grouped by level and pointing to propose_grants", async () => {
    await reachableThings()
    const id = await activeRobot({ tools: { files: 'allow', web: 'ask', tasks: 'allow', browser: 'deny' }, secrets: { shop: 'ask' } })
    const { items, view } = await toolList(id)
    const expected = await settingsList(id)
    expect(expected.length).toBeGreaterThan(20)
    expect(byKey(items)).toEqual(byKey(expected))
    // The kinds all appear: groups, a recipient, a connection with its write grant, the host's three facets, a login.
    expect([...new Set(items.map((entry) => entry.kind))]).toEqual(expect.arrayContaining(['tool group', 'recipient', 'connection', 'host', 'login']))
    expect(items.filter((entry) => entry.kind === 'host')).toHaveLength(3)
    expect(items.filter((entry) => entry.kind === 'connection')).toHaveLength(2)
    expect(view.allow.map((entry) => entry.grant)).toEqual(expect.arrayContaining(['files', 'tasks']))
    expect(view.ask.map((entry) => entry.grant)).toEqual(expect.arrayContaining(['web', 'shop']))
    expect(view.deny.map((entry) => entry.grant)).toEqual(expect.arrayContaining(['browser', 'exa']))
    expect(view.note).toContain('propose_grants')
  })

  it("lists Mr. Robot's real levels: allow on everything, under what his owner lowered", async () => {
    await reachableThings()
    const mr = await mrRobot()
    const shown = (await api<RobotPanel>(ANNA, `/api/robots/${mr}/panel`)).body.settings.grants
    await api(ANNA, `/api/robots/${mr}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { ...shown, tools: { ...shown.tools, exa: 'deny', browser: 'ask' }, secrets: { shop: 'deny' } } } })
    await testRobot(mr).activateForTest()
    const { items, view } = await toolList(mr)
    expect(byKey(items)).toEqual(byKey(await settingsList(mr)))
    const level = (kind: string, grant: string) => items.find((entry) => entry.kind === kind && entry.grant === grant)?.level
    expect(level('tool group', 'exa')).toBe('deny')
    expect(level('tool group', 'browser')).toBe('ask')
    expect(level('tool group', 'deputy')).toBe('allow')
    expect(level('login', 'shop')).toBe('deny')
    expect(view.allow.length).toBeGreaterThan(view.deny.length)
  })

  it('is not offered while a Robot is being set up', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    expect(await env.ROBOT.getByName(body.id).toolNames()).not.toContain('my_capabilities')
    await testRobot(body.id).activateForTest()
    expect(await env.ROBOT.getByName(body.id).toolNames()).toContain('my_capabilities')
  })
})

describe('docs index and runtime section (sk-xseb, sk-ixvp, sk-xsat)', () => {
  const preview = async (id: string) => (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections

  it('end the platform prompt in the preview and in the system prompt the model gets', async () => {
    await reachableThings()
    const id = await activeRobot({ tools: { files: 'allow', web: 'ask' }, secrets: { shop: 'allow' } })
    const summary = (await api<RobotSummary[]>(ANNA, '/api/robots')).body.find((robot) => robot.id === id)!
    const platform = (await preview(id)).find((section) => section.name === 'Platform')!.text
    const runtime = platform.slice(platform.indexOf('## Runtime'))
    expect(platform.indexOf(docsIndex())).toBeGreaterThan(0)
    expect(platform.indexOf(docsIndex())).toBeLessThan(platform.indexOf('## Runtime'))
    expect(runtime).toContain(`You are ${summary.identity.name}, a Robot of Anna`)
    expect(runtime).toContain('stub on stub, thinking off')
    expect(runtime).toContain(`Time zone: ${WARSAW}.`)
    expect(runtime).toContain('answer in the language Anna writes in')
    expect(runtime).toMatch(/\nallow: tools files; logins shop\nask: tools web\ndeny: tools [^\n]*browser[^\n]*; recipients 1; connections 2; hosts 3\b/)
    // Nothing follows the runtime section inside the platform prompt.
    expect(runtime.split('\n\n')).toHaveLength(1)

    // The model reads the same text, and it does not change between Turns (no clock in it).
    await say(id, 'one')
    const first = systemOf(id)
    expect(first).toContain(docsIndex().split('\n')[1]!)
    expect(first).toContain(runtime.split('\n')[0]!)
    expect(first).toContain('allow: tools files; logins shop')
    await say(id, 'two')
    expect(systemOf(id)).toBe(first)
  })

  it('show the capability rules the plugins add to the prompt', async () => {
    const id = await activeRobot({ tools: { browser: 'allow', secrets: 'allow' } })
    const sections = await preview(id)
    const names = sections.map((section) => section.name)
    expect(names).toEqual(expect.arrayContaining(['mr-robot:browser', 'mr-robot:logins']))
    expect(sections.find((section) => section.name === 'mr-robot:browser')!.text).toContain('request a browser takeover')
    // What the model reads has those rules, too.
    await say(id, 'hi')
    expect(systemOf(id)).toContain('request a browser takeover')
    // A plugin that is not mounted adds nothing.
    expect(names).not.toContain('mr-robot:exa')
  })

  it('keep the level summary out of the setup prompt', async () => {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    const runtime = (await preview(body.id)).find((section) => section.name === 'Platform')!.text.split('## Runtime')[1]!
    expect(runtime).toContain(`Time zone: ${WARSAW}.`)
    expect(runtime).not.toContain('allow:')
  })
})

describe('labels of plugin tools and Hosts (ux-5g3w, ux-q8o6, ux-qm6u, ux-ywxa, ux-czg2)', () => {
  it('the catalog, my_capabilities and the prompt preview name a connection by plugin and account, and a Host facet by its Host and state', async () => {
    await reachableThings()
    const annaId = (await api<{ id: string }>(ANNA, '/api/me')).body.id
    const google = await env.MEMBER.getByName(annaId).addConnection({ kind: 'google', label: 'anna@gmail.test', account: 'anna@gmail.test', services: ['gmail', 'gmail-send'], shared: false, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { token: 't' } })
    await env.MEMBER.getByName(annaId).addConnection({ kind: 'discord', label: 'Mr. Robot', account: 'Mr. Robot', services: [], shared: false, meta: {}, secrets: { token: 't' } })
    scripts.set('*', [{ text: 'Hello.' }])
    const id = (await api<{ id: string }>(ANNA, '/api/robots', { body: {} })).body.id
    await settle(id)

    // The catalog carries the plugin title of each connection and the Host of each facet.
    const catalog = (await api<SettingsCatalog>(ANNA, `/api/robots/${id}/catalog`)).body
    expect((catalog.connections ?? []).map((connection) => `${connection.pluginTitle} · ${connection.account}`).sort()).toEqual(['Discord bot · Mr. Robot', 'Google · anna@gmail.test', 'Slack · acme.slack.com'])
    const host = (catalog.hosts ?? [])[0]!
    expect(catalog.hosts).toEqual([expect.objectContaining({ id: host.id, name: 'Desk', online: false, mine: true })])
    expect(catalog.toolGroups.find((group) => group.name === 'web')!.description).toBe('Fetch pages by address (web_fetch, free; searching the web is the exa group).')

    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: { web: 'allow' }, connections: { [google.id]: 'allow' }, hosts: { [`${host.id}:files`]: 'ask' } } } })
    await testRobot(id).activateForTest()

    // my_capabilities names the items the same way.
    const { view } = await toolList(id)
    const entries = [...view.allow, ...view.ask, ...view.deny]
    const named = (grant: string) => entries.find((entry) => entry.grant === grant)!
    expect(view.allow.map((entry) => entry.name)).toEqual(['web', 'Google · anna@gmail.test'])
    expect(named(`${google.id}:write`).name).toBe('Google · anna@gmail.test: send e-mail')
    expect(entries.filter((entry) => entry.kind === 'connection').map((entry) => entry.name)).toEqual(expect.arrayContaining(['Slack · acme.slack.com', 'Slack · acme.slack.com: post and mark read', 'Discord bot · Mr. Robot']))
    expect(entries.filter((entry) => entry.kind === 'host').map((entry) => entry.name)).toEqual(['Desk · files', 'Desk · shell', 'Desk · browser'])
    expect(view.ask).toEqual([expect.objectContaining({ name: 'Desk · files', grant: `${host.id}:files`, description: expect.stringContaining('offline') as unknown as string })])
    expect(named('web').description).toBe('Fetch pages by address (web_fetch, free; searching the web is the exa group).')

    // The prompt preview: the same labels and the Host state in the runtime section, and the rule not to probe a Host.
    const platform = (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
    const runtime = platform.slice(platform.indexOf('## Runtime'))
    expect(runtime).toContain('\n- Hosts: Desk · offline.\n')
    expect(runtime).toContain('\nallow: tools web; connections Google · anna@gmail.test\nask: hosts Desk · files\n')
    const toolRules = platform.slice(platform.indexOf('## Tools'), platform.indexOf('## Tasks'))
    expect(toolRules).toContain('- Host online state is in the runtime section and in my_capabilities; never probe a Host with a command to find out.')
  })
})

describe('the owner line (ux-i8ff, ux-nwi1, ux-xzdh)', () => {
  const runtimeOf = async (id: string) => {
    const platform = (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
    return platform.slice(platform.indexOf('## Runtime'))
  }
  const me = async () => (await api<Me>(ANNA, '/api/me')).body

  it('the profile keeps an optional nickname; the prompt preview, the system prompt and my_capabilities name the owner the same way', async () => {
    const id = await activeRobot({})
    const mr = await mrRobot()
    expect(await me()).not.toHaveProperty('nickname')
    expect(await runtimeOf(id)).toContain('\n- Owner: Anna\n')
    expect((await toolList(id)).view.owner).toBe('Anna')

    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { nickname: '  Ania ' } })).status).toBe(200)
    expect((await me()).nickname).toBe('Ania')
    for (const robot of [id, mr]) expect(await runtimeOf(robot)).toContain('\n- Owner: Anna; address them as Ania\n')
    expect((await toolList(id)).view.owner).toBe('Anna; address them as Ania')
    // The model reads it in the Turn after the change, not only in the preview.
    expect(systemOf(id)).toContain('- Owner: Anna; address them as Ania')

    // A Robot created now names the owner the same way from the start.
    const later = await activeRobot({})
    expect(await runtimeOf(later)).toContain('\n- Owner: Anna; address them as Ania\n')

    // A rename reaches every Robot; a blank nickname removes it; null is not a nickname.
    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { nickname: null } })).status).toBe(400)
    await api(ANNA, '/api/me', { method: 'PATCH', body: { name: 'Anna Kowalska', nickname: ' ' } })
    expect(await me()).toMatchObject({ name: 'Anna Kowalska' })
    expect(await me()).not.toHaveProperty('nickname')
    for (const robot of [id, mr, later]) expect(await runtimeOf(robot)).toContain('\n- Owner: Anna Kowalska\n')
    expect((await toolList(id)).view.owner).toBe('Anna Kowalska')
  })
})

describe('the time of a Wake-up (sk-nitq)', () => {
  /** The local time of an instant in Warsaw, "YYYY-MM-DD HH:MM", from a formatter other than the product's. */
  const warsaw = (at: number) => new Date(at).toLocaleString('sv-SE', { timeZone: WARSAW }).slice(0, 16)

  it("a Member's message carries a time line of its own that the chat view does not show", async () => {
    const id = await activeRobot({})
    const before = Date.now()
    await say(id, 'Buy milk.')
    const after = Date.now()
    const text = JSON.stringify(lastRequest(id).messages.filter((message) => message.role === 'user').at(-1))
    const found = /^\{.*?"text":"\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) Europe\/Warsaw\]\\nBuy milk\."/.exec(text)
    expect(found, text).not.toBeNull()
    expect([warsaw(before), warsaw(after)]).toContain(found![1])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.filter((item) => item.kind === 'message').map((item) => item.kind === 'message' ? item.text : '')).toEqual(['Buy milk.'])
  })

  it('a Task Wake-up has the time in front of its label, on the same line', async () => {
    const id = await activeRobot({})
    scripts.set(id, [{ text: 'Checked.' }])
    const before = Date.now()
    await api(ANNA, '/api/tasks', { body: { title: 'Pulse', instructions: 'Check prices.', assignee: { kind: 'robot', robotId: id }, timing: { kind: 'scheduled', at: Date.now() - 1000 } } })
    await runDurableObjectAlarm(env.ROBOT.getByName(id))
    await settle(id)
    const after = Date.now()
    const wake = JSON.stringify(lastRequest(id).messages.at(-1))
    const found = /"text":"\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) Europe\/Warsaw\] \[Task \\"Pulse\\" \([^)]+\) is due\. Nobody is watching this turn\. When the Task is finished, call task_done\.\]\\n/.exec(wake)
    expect(found, wake).not.toBeNull()
    expect([warsaw(before), warsaw(after)]).toContain(found![1])
    const conversation = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body
    expect(conversation.items.slice(-2)).toEqual([
      expect.objectContaining({ kind: 'task', action: 'ran', title: 'Pulse' }),
      expect.objectContaining({ kind: 'reply', text: 'Checked.' }),
    ])
  })

  it('says in the Date and time section that the label gives the time', async () => {
    const id = await activeRobot({})
    const platform = (await api<{ sections: Array<{ name: string; text: string }> }>(ANNA, `/api/robots/${id}/prompt`)).body.sections.find((section) => section.name === 'Platform')!.text
    expect(platform).toContain('Every Wake-up starts with a label that gives the local time in your time zone')
    expect(platform).not.toContain('not what time it is')
  })
})
