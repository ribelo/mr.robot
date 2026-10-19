import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { OLD_SESSION_EVENTS, OLD_SESSION_HEADER } from './fixtures/session-log-0.2.0-rc.2.ts'
import { robot, say } from './robots.ts'
import { requests, scripts } from './stub-llm.ts'

// v1.14 ticket 01: a Conversation written on DSH 0.2.0-rc.2 survives the upgrade (ao-wzw9).
describe('a session log from DSH 0.2.0-rc.2', () => {
  it('renders as before and a new Turn appends to it', async () => {
    const r = await robot('r-old-log')
    const { sessionId } = await r.sessionEvents({})
    await runInDurableObject(env.ROBOT.getByName('r-old-log'), async (_robot, state) => {
      const sql = state.storage.sql
      sql.exec('INSERT INTO session_log (id, header, inherited, length) VALUES (?, ?, 0, ?)', sessionId, JSON.stringify({ ...OLD_SESSION_HEADER, id: sessionId }), OLD_SESSION_EVENTS.length)
      for (const event of OLD_SESSION_EVENTS) sql.exec('INSERT INTO session_event (session_id, seq, event) VALUES (?, ?, ?)', sessionId, event.seq, JSON.stringify(event))
    })

    // What the 0.2.0-rc.2 build rendered for this log.
    const before = await r.conversation()
    expect(before.items.map((item) => item.kind === 'message' ? [item.kind, item.text, item.reaction] : item.kind === 'reply' ? [item.kind, item.text] : item.kind === 'activity' ? [item.kind, item.tools] : [item.kind]))
      .toEqual([['message', 'Hi there', '👀'], ['reply', 'Let me react.'], ['activity', ['code']], ['reply', 'Hello, owner. I saw your message.']])
    const old = await r.trajectory()
    expect(old.map((event) => event.type)).toEqual(OLD_SESSION_EVENTS.map((event) => event.type))

    scripts.set('r-old-log', [{ text: 'Still here.' }])
    await r.wake(say('Are you there?'))
    await r.settled()
    const after = await r.trajectory()
    expect(after.slice(0, old.length)).toEqual(old)
    expect(after.map((event) => event.seq)).toEqual(after.map((_, index) => index))
    expect(after.filter((event) => event.type === 'turn/start')).toHaveLength(2)
    expect(after.at(-1)?.type).toBe('turn/end')
    // The new Turn's request carries the old Turn as history.
    const request = JSON.stringify(requests.get('r-old-log')!.at(-1)!.messages)
    expect(request).toContain('Hello, owner. I saw your message.')
    expect(request).toContain('Are you there?')
    const { items } = await r.conversation()
    expect(items.slice(0, before.items.length)).toEqual(before.items)
    expect(items.slice(before.items.length).map((item) => item.kind === 'message' || item.kind === 'reply' ? [item.kind, item.text] : [item.kind]))
      .toEqual([['message', 'Are you there?'], ['reply', 'Still here.']])
  })
})
