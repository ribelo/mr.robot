import type { CSSProperties } from 'react'
import { createAvatar } from '@dicebear/core'
import { bottts } from '@dicebear/collection'
import { memberAvatarPath, type FleetState, type MemberAvatar } from '@mr-robot/protocol'

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

const HEX = /^#[0-9a-fA-F]{6}$/

/** Drawn faces by seed and colour: the sidebar draws the same Robots on every render. */
const drawn = new Map<string, string>()

/** A Robot's bottts face (ux-0zm6), deterministic from its seed, on a circle of its colour; as an image URI. */
export function robotFace(seed: string, color: string): string {
  const key = `${seed}|${color}`
  const cached = drawn.get(key)
  if (cached !== undefined) return cached
  const face = createAvatar(bottts, { seed, radius: 50, ...(HEX.test(color) ? { backgroundColor: [color.slice(1).toLowerCase()] } : {}) }).toDataUri()
  drawn.set(key, face)
  return face
}

/** A Robot's avatar: its generated robot tinted with its colour, animated per fleet state. */
export function Avatar({ seed, color, size = 36, state }: { seed: string; color: string; size?: number; state?: FleetState }) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span className={`avatar ${avatarStateClass(state)}`} style={style} aria-hidden="true">
      <img className="avatar-face" src={robotFace(seed, color)} width={size} height={size} alt="" data-seed={seed} />
      {state === 'waiting for you' ? <span className="avatar-ring" /> : null}
      {state === 'blocked' ? <span className="avatar-mark">!</span> : null}
    </span>
  )
}

/** A Member's avatar (ux-2ft4, ux-s88l): their picture, or their initials on their colour. */
export function MemberFace({ memberId, name, avatar, size = 28 }: { memberId: string; name: string; avatar: MemberAvatar; size?: number }) {
  const style: CSSProperties = { width: size, height: size, background: avatar.color }
  switch (avatar.kind) {
    case 'picture':
      return <img className="member-face" style={style} src={memberAvatarPath(memberId, avatar.key)} width={size} height={size} alt={name} />
    case 'initials':
      return <span className="member-face initials" style={{ ...style, fontSize: Math.max(10, Math.round(size * 0.4)) }} role="img" aria-label={name}>{initials(name)}</span>
  }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?'
}
