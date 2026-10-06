import { useEffect, useRef } from 'react'

/**
 * Subscribe to a Robot's live updates: the Robot DO pushes "changed" over a WebSocket and
 * the view refetches. The socket reconnects after the phone wakes up.
 */
export function useLive(robotId: string | undefined, onChange: (working: boolean) => void): void {
  const callback = useRef(onChange)
  callback.current = onChange
  useEffect(() => {
    if (robotId === undefined) return
    let socket: WebSocket | undefined
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${location.host}/api/robots/${robotId}/ws`)
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data === 'pong') return
        const message = JSON.parse(event.data) as { working?: boolean }
        callback.current(message.working === true)
      }
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000)
      }
    }
    connect()
    const wake = () => {
      if (document.visibilityState === 'visible' && socket?.readyState !== WebSocket.OPEN) {
        socket?.close()
        connect()
      }
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      closed = true
      if (retry !== undefined) clearTimeout(retry)
      document.removeEventListener('visibilitychange', wake)
      socket?.close()
    }
  }, [robotId])
}
