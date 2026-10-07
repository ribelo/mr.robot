import { useEffect, useRef, useState, type PointerEvent } from 'react'

export interface TakeoverProps {
  readonly robotId: string
  readonly robotName: string
  /** The Robot asked for a takeover; without it the owner can still take an idle Robot's browser (rb-keaw). */
  readonly requested: { readonly reason: string } | null
  readonly onClose: () => void
}

/**
 * The Robot's browser on the phone (robot-ksvy, robot-g6qb): live frames over the Robot's
 * WebSocket; after claiming, taps, text and keys go to the page; "Hand back" resumes the Robot.
 */
export function Takeover({ robotId, robotName, requested, onClose }: TakeoverProps) {
  const socket = useRef<WebSocket | undefined>(undefined)
  const image = useRef<HTMLImageElement>(null)
  const [frame, setFrame] = useState<{ src: string; width: number; height: number }>()
  const [claimed, setClaimed] = useState(false)
  const [message, setMessage] = useState<string>()
  const [text, setText] = useState('')

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/api/robots/${encodeURIComponent(robotId)}/ws`)
    socket.current = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'live', on: true }))
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data === 'pong') return
      const data = JSON.parse(event.data) as { type: string; data?: string; metadata?: { deviceWidth?: number; deviceHeight?: number }; message?: string }
      if (data.type === 'frame' && data.data !== undefined) {
        setFrame({ src: `data:image/jpeg;base64,${data.data}`, width: data.metadata?.deviceWidth ?? 1280, height: data.metadata?.deviceHeight ?? 800 })
      } else if (data.type === 'claimed') {
        setClaimed(true)
      } else if (data.type === 'claim-refused') {
        setMessage('Someone else is using this browser right now.')
      } else if (data.type === 'error' && data.message !== undefined) {
        setMessage(data.message)
      }
    }
    return () => {
      ws.send(JSON.stringify({ type: 'live', on: false }))
      ws.close()
    }
  }, [robotId])

  const send = (input: Record<string, unknown>) => socket.current?.send(JSON.stringify(input))

  /** Map a tap on the scaled picture to page coordinates. */
  const tap = (event: PointerEvent<HTMLImageElement>) => {
    if (!claimed || frame === undefined || image.current === null) return
    const box = image.current.getBoundingClientRect()
    send({ type: 'tap', x: ((event.clientX - box.left) / box.width) * frame.width, y: ((event.clientY - box.top) / box.height) * frame.height })
  }

  return (
    <div className="takeover" role="dialog" aria-label={`${robotName}'s browser`}>
      <div className="takeover-bar">
        <span className="conversation-name">{robotName}’s browser</span>
        <span className="spacer" />
        {!claimed ? <button type="button" className="button button-primary" onClick={() => send({ type: 'claim' })}>Take over</button> : null}
        {claimed ? <button type="button" className="button button-primary" onClick={() => { send({ type: 'handback' }); onClose() }}>Hand back</button> : null}
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {requested === null ? null : <div className="muted" style={{ padding: '0 14px' }}>{requested.reason}</div>}
      {message === undefined ? null : <div className="muted" style={{ padding: '0 14px' }}>{message}</div>}
      <div className="takeover-screen">
        {frame === undefined
          ? <div className="muted">Opening the browser at its last page…</div>
          : <img ref={image} src={frame.src} alt="" onPointerUp={tap} draggable={false} />}
      </div>
      {claimed ? (
        <div className="takeover-keys">
          <input value={text} placeholder="Type into the focused field" onChange={(event) => setText(event.target.value)} />
          <button type="button" className="button" onClick={() => { send({ type: 'text', text }); setText('') }}>Send</button>
          <button type="button" className="button" onClick={() => send({ type: 'key', key: 'Backspace' })}>⌫</button>
          <button type="button" className="button" onClick={() => send({ type: 'key', key: 'Enter' })}>⏎</button>
          <button type="button" className="button" onClick={() => send({ type: 'scroll', x: (frame?.width ?? 0) / 2, y: 300, dy: 500 })}>↓</button>
        </div>
      ) : null}
    </div>
  )
}
