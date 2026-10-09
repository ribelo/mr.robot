import type { CSSProperties } from 'react'
import type { FleetState } from '@mr-robot/protocol'

/** The look of each fleet state (ap-bxt2); the animation itself is CSS (styles.css), off under reduced motion. */
export function avatarStateClass(state: FleetState | undefined): string {
  switch (state) {
    case 'working': return 'avatar-working'
    case 'waiting for you': return 'avatar-waiting'
    case 'blocked': return 'avatar-blocked'
    case 'paused': return 'avatar-paused'
    case 'sleeping': case 'setup': case undefined: return 'avatar-idle'
  }
}

/** The blob face of a Robot, in its avatar colour (as in the reference screens), animated per fleet state. */
export function Avatar({ color, size = 36, state }: { color: string; size?: number; state?: FleetState }) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span className={`avatar ${avatarStateClass(state)}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <path d="M20 3c9 0 17 6.5 17 17.5S29.5 37 20 37 3 31 3 20.5 11 3 20 3z" fill={color} />
        <ellipse cx="15" cy="15" rx="1.4" ry="3.2" transform="rotate(-20 15 15)" fill="rgba(0,0,0,.55)" />
        <ellipse cx="21.5" cy="14.6" rx="1.4" ry="3.2" transform="rotate(10 21.5 14.6)" fill="rgba(0,0,0,.55)" />
      </svg>
      {state === 'waiting for you' ? <span className="avatar-ring" /> : null}
      {state === 'blocked' ? <span className="avatar-mark">!</span> : null}
    </span>
  )
}
