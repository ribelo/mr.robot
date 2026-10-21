import { env, reset, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionNote, ConnectionView, ConnectorKind, Me, PluginView, RobotPanel } from '@mr-robot/protocol'
import { api, robots, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

// v1.12 ticket 08: a connection that acts as a person (Slack, Google) is never shared with the Space.
const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
let annaId = ''
let benId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  benId = (await api<Me>(BEN, '/api/me')).body.id
})

/** A connection as it was stored before v1.12, shared or not; the edge API is not involved. */
const stored = (memberId: string, kind: ConnectorKind, label: string, account: string, shared: boolean) =>
  env.MEMBER.getByName(memberId).addConnection({ kind, label, account, services: [], shared, meta: { expiresAt: Date.now() + 3_600_000 }, secrets: { token: 'xoxc-token', cookie: 'xoxd-cookie' } })

async function robotOf(as: string, connections: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(as, '/api/robots', { body: {} })
  await settle(body.id)
  await api(as, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: [], skills: [], recipients: [], secrets: [], connections } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function turn(as: string, id: string, text: string) {
  scripts.set(id, [{ text: 'Ok.' }])
  await api(as, `/api/robots/${id}/messages`, { body: { text } })
  await settle(id)
}

/** The user messages the last model request added to the one before: what this Turn brought in. */
const newUser = (id: string) => {
  const sent = (requests.get(id) ?? []).filter((request) => request.purpose !== 'compaction')
  const [before, last] = [sent.at(-2)?.messages.length ?? 0, sent.at(-1)!]
  return JSON.stringify(last.messages.slice(before).filter((message) => message.role === 'user'))
}
const toolsOf = async (as: string, id: string) => (await api<{ tools: string[] }>(as, `/api/robots/${id}/prompt`)).body.tools
const connectionGrants = async (as: string, id: string) => (await api<RobotPanel>(as, `/api/robots/${id}/panel`)).body.settings.grants.connections
const notes = async (as: string) => (await api<ConnectionNote[]>(as, '/api/connections/notes')).body
const byName = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))

describe('the server refuses sharing a person connection (ux-bk91, ux-ro7d)', () => {
  it('marks Slack and Google as acting as a person, Discord not', async () => {
    const plugins = (await api<PluginView[]>(ANNA, '/api/plugins')).body
    const flags = (name: string) => plugins.find((plugin) => plugin.name === name)!.connectors.map((way) => [way.kind, way.actsAsPerson])
    expect([...flags('slack'), ...flags('google'), ...flags('discord')]).toEqual([['slack', true], ['google', true], ['discord', false], ['discord-user', true]])
  })

  it('refuses shared on create and update for Slack and Google; a Discord bot still shares', async () => {
    const created = await api<{ error: string }>(ANNA, '/api/connections/slack', { body: { shared: true, values: { token: 'xoxc-token', cookie: 'xoxd-cookie' } } })
    expect(created.status).toBe(400)
    expect(created.body.error).toBe('a Slack connection acts as you, so it cannot be shared with the Space')
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])

    const slack = await stored(annaId, 'slack', 'Acme', 'acme.slack.com', false)
    const google = await stored(annaId, 'google', 'Private', 'anna@gmail.test', false)
    for (const connection of [slack, google]) {
      const refused = await api<{ error: string }>(ANNA, `/api/connections/${connection.id}`, { method: 'PATCH', body: { shared: true } })
      expect(refused.status).toBe(400)
      expect(refused.body.error).toContain('acts as you, so it cannot be shared with the Space')
      // Other changes, and shared: false, still go through.
      const renamed = await api<ConnectionView>(ANNA, `/api/connections/${connection.id}`, { method: 'PATCH', body: { label: 'Renamed', shared: false } })
      expect(renamed.status).toBe(200)
      expect(renamed.body).toMatchObject({ label: 'Renamed', shared: false })
    }
    expect((await api<ConnectionView[]>(BEN, '/api/connections')).body).toEqual([])

    const consent = await SELF.fetch('https://mr-robot.test/api/connections/google/oauth/start?services=gmail&shared=1', { headers: { 'x-dev-identity': ANNA }, redirect: 'manual' })
    expect(consent.status).toBe(302)
    expect(decodeURIComponent(consent.headers.get('location')!)).toContain('connection-error=a Google connection acts as you')

    const bot = await stored(annaId, 'discord', 'Bot', 'mr-robot', false)
    const shared = await api<ConnectionView>(ANNA, `/api/connections/${bot.id}`, { method: 'PATCH', body: { shared: true } })
    expect(shared.status).toBe(200)
    expect(shared.body.shared).toBe(true)
    expect((await api<ConnectionView[]>(BEN, '/api/connections')).body).toEqual([expect.objectContaining({ id: bot.id, ownerName: 'Anna', shared: true })])
  })
})

describe('the update unshares person connections (ux-cop2, ux-dz8p, ux-ro7d)', () => {
  it("unshares, revokes other Members' grants, notes it for the owner and tells each affected Robot once", async () => {
    const slack = await stored(benId, 'slack', 'Acme', 'acme.slack.com', true)
    const bot = await stored(benId, 'discord', 'Bot', 'mr-robot', true)
    const annas = await robotOf(ANNA, [slack.id, `${slack.id}:write`, bot.id])
    const bens = await robotOf(BEN, [slack.id])
    const annaRobots = await robots(ANNA)
    const annaMr = annaRobots.find((robot) => robot.kind === 'mr-robot')!
    // Both of Anna's Robots have seen their baseline, so the change reaches them as a note.
    await turn(ANNA, annas, 'hello')
    await turn(ANNA, annaMr.id, 'hello')
    expect(await toolsOf(ANNA, annas)).toContain('slack_read_channel')

    await env.SPACE.getByName('space').unsharePersonConnections()

    // The connection is Ben's alone now; the Discord bot stays shared.
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body.map((connection) => connection.id)).toEqual([bot.id])
    expect((await api<ConnectionView[]>(BEN, '/api/connections')).body.find((connection) => connection.id === slack.id)).toMatchObject({ shared: false })
    // Anna's Robot lost the grant rows and the tools; Ben's own Robot keeps them.
    expect(await connectionGrants(ANNA, annas)).toEqual({ [bot.id]: 'allow' })
    expect(await toolsOf(ANNA, annas)).not.toContain('slack_read_channel')
    expect(await toolsOf(BEN, bens)).toContain('slack_read_channel')

    // Ben's note names what changed and which Robots lost it; Anna has none.
    const [note, ...more] = await notes(BEN)
    expect(more).toEqual([])
    expect(note).toMatchObject({ kind: 'slack', label: 'Acme', account: 'acme.slack.com' })
    expect(byName(note!.robots)).toEqual(byName(annaRobots.map((robot) => ({ name: robot.identity.name, ownerName: 'Anna' }))))
    expect(await notes(ANNA)).toEqual([])

    // Each affected Robot hears it at its next Turn, once; Ben's Robot hears nothing.
    const told = 'acts as Ben, so it is no longer shared with the Space and your grant on it was removed.'
    await turn(ANNA, annas, 'what now?')
    expect(newUser(annas)).toContain('Slack connection')
    expect(newUser(annas)).toContain(told)
    await turn(ANNA, annas, 'and again?')
    expect(newUser(annas)).not.toContain(told)
    await turn(ANNA, annaMr.id, 'what now?')
    expect(newUser(annaMr.id)).toContain(told)
    await turn(BEN, bens, 'what now?')
    expect(newUser(bens)).not.toContain(told)

    // Running it again changes nothing.
    await env.SPACE.getByName('space').unsharePersonConnections()
    expect(await notes(BEN)).toHaveLength(1)

    // Only the owner dismisses the note.
    expect((await api(ANNA, `/api/connections/notes/${note!.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await api(BEN, `/api/connections/notes/${note!.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await notes(BEN)).toEqual([])
  })

  it('notes a shared person connection that no Robot of another Member held', async () => {
    const google = await stored(benId, 'google', 'Space', 'ben@gmail.test', true)
    // Anna's Mr. Robot reaches it unless she lowers it to deny.
    const annaMr = (await robots(ANNA)).find((robot) => robot.kind === 'mr-robot')!
    await api(ANNA, `/api/robots/${annaMr.id}/settings`, { method: 'PATCH', body: { grants: { connections: { [google.id]: 'deny' } } } })
    expect((await connectionGrants(ANNA, annaMr.id))[google.id]).toBe('deny')

    await env.SPACE.getByName('space').unsharePersonConnections()

    expect(await notes(BEN)).toEqual([expect.objectContaining({ kind: 'google', label: 'Space', account: 'ben@gmail.test', robots: [] })])
    expect((await api<ConnectionView[]>(ANNA, '/api/connections')).body).toEqual([])
  })
})
