import { reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'

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
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false } })
  await testRobot(body.id).activateForTest()
  return body.id
}

/** A long Conversation: the owner writes about invoices thirty times, one early and one late phrase stand out. */
async function longConversation(id: string): Promise<void> {
  for (let index = 1; index <= 30; index += 1) {
    const text = index === 2 ? 'The zeppelin invoice is overdue' : index === 29 ? 'Please book the quokka invoice' : `Invoice number ${index} needs a check`
    scripts.set(id, [{ text: index === 29 ? 'Booked the quokka.' : `Checked invoice ${index}.` }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text } })
    await settle(id)
  }
}

const lastToolResult = (id: string) => requests.get(id)!.at(-1)!.messages.filter((message) => message.role === 'tool').at(-1)!.content.map((block) => ('text' in block ? block.text : '')).join('')

describe('searching the own Conversation (cd-ggem)', () => {
  it('finds an early and a late phrase, newest first, with who said it and a snippet', async () => {
    const id = await activeRobot()
    await longConversation(id)
    const robot = env.ROBOT.getByName(id)

    const early = await robot.searchConversation('zeppelin')
    expect(early.nextPage).toBeNull()
    expect(early.items).toEqual([expect.objectContaining({ sender: 'Anna', snippet: 'The zeppelin invoice is overdue' })])

    const late = await robot.searchConversation('quokka')
    expect(late.items.map((item) => [item.sender, item.snippet])).toEqual([['New robot', 'Booked the quokka.'], ['Anna', 'Please book the quokka invoice']])

    const chat = (await robot.conversationView()).items
    expect(chat.find((item) => item.id === early.items[0]!.id)).toMatchObject({ kind: 'message', text: 'The zeppelin invoice is overdue' })
  })

  it('pages through a word found in most of the Conversation', async () => {
    const id = await activeRobot()
    await longConversation(id)
    const robot = env.ROBOT.getByName(id)

    const first = await robot.searchConversation('invoice')
    expect(first.items).toHaveLength(10)
    expect(first.nextPage).toBe(2)
    const seen = [...first.items]
    for (let page = first.nextPage; page !== null;) {
      const next = await robot.searchConversation('invoice', page)
      seen.push(...next.items)
      page = next.nextPage
    }
    // 30 owner messages and 29 replies mention an invoice (the reply to the quokka does not); each item once, newest first.
    expect(seen).toHaveLength(59)
    expect(new Set(seen.map((item) => item.id)).size).toBe(59)
    expect(seen.map((item) => item.at)).toEqual([...seen.map((item) => item.at)].sort((a, b) => b - a))
    expect(seen[0]!.snippet).toBe('Checked invoice 30.')
    expect(seen.at(-1)!.snippet).toBe('Invoice number 1 needs a check')
  })

  it('is a tool every Robot has; a Turn calls it and gets the page', async () => {
    const id = await activeRobot()
    await longConversation(id)
    scripts.set(id, [{ calls: [{ name: 'conversation_search', args: { query: 'zeppelin overdue' } }] }, { text: 'Found it.' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what did I say about the zeppelin?' } })
    await settle(id)
    const result = JSON.parse(lastToolResult(id)) as { items: Array<{ id: string; sender: string; at: string; snippet: string }>; nextPage: number | null }
    expect(result.nextPage).toBeNull()
    expect(result.items[0]).toMatchObject({ sender: 'Anna', snippet: 'The zeppelin invoice is overdue' })
    expect(Number.isNaN(Date.parse(result.items[0]!.at))).toBe(false)
  })
})
