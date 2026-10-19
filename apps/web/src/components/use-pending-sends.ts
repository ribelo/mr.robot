import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment, ChatItem } from '@mr-robot/protocol'
import * as Exit from 'effect/Exit'
import { exitFailure, type ApiFailure } from '../client/api-failure.ts'
import { unconfirmed, type PendingSend } from './pending-sends.ts'

export interface OutgoingMessage {
  readonly clientId: string
  readonly text: string
  readonly attachments: Attachment[]
  /** Waits for a Turn of its own (Ctrl+Enter, ao-q2z4). */
  readonly followup?: true
}

const newClientId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * Optimistic sending (ap-3si6, ap-ceqx): send() shows the message at once and posts it; the message
 * stays in `pending` until the Conversation holds it. A refused or unreachable send is kept as failed;
 * retry() posts it again with the same client id, which the Worker accepts once.
 */
export function usePendingSends(items: readonly ChatItem[], meId: string, post: (message: OutgoingMessage) => Promise<Exit.Exit<unknown, ApiFailure>>) {
  const [sends, setSends] = useState<readonly PendingSend[]>([])
  const pending = unconfirmed(sends, items, meId)
  // Forget confirmed sends for good.
  useEffect(() => { if (pending.length !== sends.length) setSends(pending) }, [pending.length, sends.length])
  const latest = useRef(sends)
  latest.current = sends

  const attempt = useCallback(async (message: OutgoingMessage) => {
    const exit = await post(message)
    if (Exit.isSuccess(exit)) return
    const error = exitFailure(exit)
    setSends((current) => current.map((send) => (send.clientId === message.clientId ? { ...send, state: 'failed', ...(error === undefined ? {} : { error }) } : send)))
  }, [post])

  const send = useCallback((text: string, attachments: Attachment[], followup = false) => {
    const message: OutgoingMessage = { clientId: newClientId(), text, attachments, ...(followup ? { followup: true } : {}) }
    setSends((current) => [...current, { ...message, state: 'pending', knownItems: new Set(items.map((item) => item.id)) }])
    void attempt(message)
    return message.clientId
  }, [attempt, items])

  const retry = useCallback((clientId: string) => {
    const failed = latest.current.find((entry) => entry.clientId === clientId && entry.state === 'failed')
    if (failed === undefined) return
    setSends((current) => current.map((entry) => {
      if (entry.clientId !== clientId) return entry
      const { error: _error, ...rest } = entry
      return { ...rest, state: 'pending' }
    }))
    void attempt({ clientId, text: failed.text, attachments: [...failed.attachments], ...(failed.followup === true ? { followup: true } : {}) })
  }, [attempt])

  return { pending, send, retry }
}
