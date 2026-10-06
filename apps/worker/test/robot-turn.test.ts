import { env } from 'cloudflare:workers'
import { abortAllDurableObjects, runDurableObjectAlarm } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { robot, say } from './robots.ts'
import { scripts } from './stub-llm.ts'

describe('a Robot runs a Turn', () => {
  it('answers a message and keeps it in its Conversation (robot-frf5, robot-q4b2)', async () => {
    scripts.set('r-answer', [{ text: 'Hello, owner.' }])
    const r = await robot('r-answer')
    await r.wake(say('Hi'))
    await r.settled()
    const { items } = await r.conversation()
    expect(items.map((item) => item.kind === 'message' || item.kind === 'reply' ? [item.kind, item.text] : [item.kind]))
      .toEqual([['message', 'Hi'], ['reply', 'Hello, owner.']])
    const types = (await r.trajectory()).map((event) => event.type)
    expect(types).toContain('user/message')
    expect(types.at(-1)).toBe('turn/end')
  })

  it('finishes the Turn when nobody waits for it (robot-p9jm)', async () => {
    scripts.set('r-alone', [{ text: 'Done while you were away.' }])
    await (await robot('r-alone')).wake(say('Do it'))
    const later = env.ROBOT.getByName('r-alone')
    await later.settled()
    const { items, working } = await later.conversation()
    expect(working).toBe(false)
    expect(items.at(-1)).toMatchObject({ kind: 'reply', text: 'Done while you were away.' })
  })

  it('appends a second Turn after the first; the log is never rewritten', async () => {
    scripts.set('r-append', [{ text: 'one' }, { text: 'two' }])
    const r = await robot('r-append')
    await r.wake(say('first'))
    await r.settled()
    const first = await r.trajectory()
    await r.wake(say('second'))
    await r.settled()
    const second = await r.trajectory()
    expect(second.slice(0, first.length)).toEqual(first)
    expect(second.map((event) => event.seq)).toEqual(second.map((_, index) => index))
    expect(second.filter((event) => event.type === 'turn/start')).toHaveLength(2)
  })

  it('reacts with a thumbs-up instead of replying (robot-i3et)', async () => {
    scripts.set('r-react', [{ calls: [{ name: 'react', args: { emoji: '👍' } }] }, { text: '' }])
    const r = await robot('r-react')
    await r.wake(say('Run this every week.'))
    await r.settled()
    const { items } = await r.conversation()
    expect(items).toEqual([expect.objectContaining({ kind: 'message', text: 'Run this every week.', reaction: '👍' })])
  })

  it('resumes a Turn interrupted by a crash from the last persisted event (robot-p9jm)', async () => {
    scripts.set('r-evict', [
      { calls: [{ name: 'react', args: { emoji: '👀' } }] },
      { hang: true },
      { text: 'Finished after the restart.' },
    ])
    const r = await robot('r-evict')
    await r.wake(say('Long job'))
    // Wait until the tool result is persisted and the second model request hangs.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const types = (await r.trajectory()).map((event) => event.type)
      if (types.includes('tool/result') && types.at(-1) !== 'tool/result' && types.at(-1) !== 'turn/end') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // A crash: the isolate holding the Turn is gone without warning.
    await abortAllDurableObjects()
    const revived = env.ROBOT.getByName('r-evict')
    expect(await runDurableObjectAlarm(revived)).toBe(true)
    await revived.settled()
    const events = await revived.trajectory()
    expect(events.filter((event) => event.type === 'tool/result')).toHaveLength(1)
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index))
    const { items, working } = await revived.conversation()
    expect(working).toBe(false)
    expect(items.at(-1)).toMatchObject({ kind: 'reply', text: 'Finished after the restart.' })
  })
})