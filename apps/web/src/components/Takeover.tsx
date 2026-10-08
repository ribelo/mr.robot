import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { useTakeover } from '../client/takeover-channel.ts'

export interface TakeoverProps {
  readonly robotId: string
  readonly robotName: string
  /** The Robot asked for a takeover; without it the owner can still take an idle Robot's browser (rb-keaw). */
  readonly requested: { readonly reason: string } | null
  readonly onClose: () => void
}

/** Keys the browser page needs as key events; printable characters go as text. */
const SPECIAL = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'])

/** CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8. */
const modifiersOf = (event: KeyboardEvent) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)

/**
 * The Robot's browser (robot-ksvy, robot-g6qb, v1.3 ticket 04): live frames over the Robot's
 * WebSocket. After claiming, the screen takes the keyboard: typing goes straight to the page
 * (pl-485j), with a keyboard button for phones (pl-vwq6). Closing hands the browser back (pl-glfh).
 */
export function Takeover({ robotId, robotName, requested, onClose }: TakeoverProps) {
  const { state, send } = useTakeover(robotId)
  const { frame, claimed, status, timing, logins } = state
  const image = useRef<HTMLImageElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  // Hidden lists close locally until the server sends a new one.
  const [loginsDismissed, setLoginsDismissed] = useState(false)
  const message = state.message ?? undefined
  // Taking over focuses the screen so typing goes to the page at once (pl-485j).
  useEffect(() => { if (claimed) screen.current?.focus() }, [claimed])
  useEffect(() => { setLoginsDismissed(false) }, [logins])


  /** Map a tap on the scaled picture to page coordinates. */
  const point = (clientX: number, clientY: number) => {
    if (frame === null || image.current === null) return undefined
    const box = image.current.getBoundingClientRect()
    return { x: ((clientX - box.left) / box.width) * frame.width, y: ((clientY - box.top) / box.height) * frame.height }
  }
  const tap = (event: PointerEvent<HTMLImageElement>) => {
    if (!claimed) return
    const at = point(event.clientX, event.clientY)
    if (at !== undefined) send({ type: 'tap', ...at })
    screen.current?.focus()
  }
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!claimed) return
    const at = point(event.clientX, event.clientY) ?? { x: (frame?.width ?? 0) / 2, y: 300 }
    send({ type: 'scroll', ...at, dy: event.deltaY })
  }
  /** Keystrokes on the focused screen go to the page (pl-485j). */
  const keyDown = (event: KeyboardEvent<HTMLDivElement | HTMLInputElement>) => {
    if (!claimed) return
    const modifiers = modifiersOf(event)
    if (SPECIAL.has(event.key) || (modifiers & 0b0110) !== 0) {
      event.preventDefault()
      send({ type: 'key', key: event.key, code: event.code, modifiers })
    } else if (event.key.length === 1) {
      event.preventDefault()
      send({ type: 'text', text: event.key })
    }
  }

  return (
    <div className="takeover" role="dialog" aria-label={`${robotName}'s browser`}>
      <div className="takeover-bar">
        <span className="conversation-name">{robotName}’s browser</span>
        {timing === null ? null : <span className="muted takeover-timing">{timing}</span>}
        <span className="spacer" />
        {!claimed ? <button type="button" className="button button-primary" onClick={() => send({ type: 'claim' })}>Take over</button> : null}
        {claimed ? <button type="button" className="button button-primary" onClick={() => { send({ type: 'handback' }); onClose() }}>Hand back</button> : null}
        <button type="button" className="icon-button" aria-label="Close and hand back" title="Close and hand back" onClick={onClose}>×</button>
      </div>
      <div className="takeover-note muted">
        {requested === null ? null : <span>{requested.reason} · </span>}
        Logins and cookies you enter here stay in {robotName}’s browser for its next tasks. Closing this window hands the browser back.
      </div>
      {message === undefined ? null : <div className="takeover-note">{message}</div>}
      <div
        ref={screen}
        className={claimed ? (focused ? 'takeover-screen typing' : 'takeover-screen claimed') : 'takeover-screen'}
        tabIndex={claimed ? 0 : -1}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onWheel={wheel}
        aria-label={claimed ? 'Browser screen: click it and type' : 'Browser screen'}
      >
        {frame === null
          ? <div className="muted">{status || 'Opening the browser…'}</div>
          : <img ref={image} src={frame.src} alt="" onPointerUp={tap} draggable={false} />}
      </div>
      {claimed ? (
        <div className="takeover-keys">
          <span className="muted">{focused ? 'Typing goes to the page.' : 'Click the screen to type into the page.'}</span>
          <span className="spacer" />
          {/* Phones show no keyboard for a div; this field opens it and forwards every key. */}
          <input ref={phoneInput} className="phone-keyboard" aria-label="Keyboard" value="" onChange={() => undefined} onKeyDown={keyDown}
            onInput={(event) => { const value = (event.target as HTMLInputElement).value; if (value !== '') send({ type: 'text', text: value }); (event.target as HTMLInputElement).value = '' }} />
          <button type="button" className="button" aria-label="Show the keyboard" onClick={() => phoneInput.current?.focus()}>⌨</button>
          <button type="button" className="button" aria-label="Logins for this page" onClick={() => send({ type: 'logins' })}>🔑</button>
        </div>
      ) : null}
      {claimed && logins !== null && !loginsDismissed ? (
        <div className="takeover-logins">
          {logins.length === 0 ? <span className="muted">No login granted to this Robot matches this page.</span> : logins.map((login) => (
            <button key={login.name} type="button" className="button" onClick={() => send({ type: 'fill', name: login.name })}>{login.name}{login.username === '' ? '' : ` (${login.username})`}</button>
          ))}
          <button type="button" className="link" onClick={() => setLoginsDismissed(true)}>Close</button>
        </div>
      ) : null}
    </div>
  )
}
