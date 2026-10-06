import type { CSSProperties } from 'react'

/** The blob face of a Robot, in its avatar colour (as in the reference screens). */
export function Avatar({ color, size = 36, badge = false }: { color: string; size?: number; badge?: boolean }) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <path d="M20 3c9 0 17 6.5 17 17.5S29.5 37 20 37 3 31 3 20.5 11 3 20 3z" fill={color} />
        <ellipse cx="15" cy="15" rx="1.4" ry="3.2" transform="rotate(-20 15 15)" fill="rgba(0,0,0,.55)" />
        <ellipse cx="21.5" cy="14.6" rx="1.4" ry="3.2" transform="rotate(10 21.5 14.6)" fill="rgba(0,0,0,.55)" />
      </svg>
      {badge ? <span className="avatar-badge" /> : null}
    </span>
  )
}
