import { useEffect, useMemo, useState } from 'react'
import type { ChatItem, ToolCallDetail, WorkDetails } from '@mr-robot/protocol'
import { useCommand } from '../client/api-atoms.ts'

/** The most activity items one request asks for, as the server bounds it. */
const PAGE_ITEMS = 40

/**
 * At Code (v1.21, cw-sc3z): the loaded page's tool calls read in full from the chapter log, by call id. The chat rows carry clipped
 * copies; this asks for the newest PAGE_ITEMS activity items with calls once, and again when the page shows new ones.
 */
export function useCodeCalls(robotId: string, items: readonly ChatItem[], level: WorkDetails): ReadonlyMap<string, ToolCallDetail> {
  const command = useCommand()
  const [details, setDetails] = useState<ReadonlyMap<string, ToolCallDetail>>(new Map())
  const request = useMemo(() => level !== 'code' ? [] : items
    .flatMap((item) => (item.kind === 'activity' && item.calls !== undefined && item.calls.length > 0 ? [{ id: item.id, calls: item.calls.map((call) => call.id) }] : []))
    .slice(-PAGE_ITEMS), [items, level])
  const key = request.map((item) => `${item.id}:${item.calls.join(',')}`).join('|')
  useEffect(() => {
    if (request.length === 0) return
    let current = true
    void command((api) => api.toolCalls(robotId, { items: request }), []).then((exit) => {
      if (!current || exit._tag !== 'Success') return
      setDetails((before) => new Map([...before, ...exit.value.calls.map((call) => [call.id, call] as const)]))
    })
    return () => { current = false }
    // The key names the page's calls; the request array changes identity with every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, robotId, command])
  return details
}
