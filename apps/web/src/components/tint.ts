import type { CSSProperties } from 'react'

const COLOR = /^#[0-9a-fA-F]{3,8}$/

/**
 * A Robot's message background (ap-yzs4): its colour mixed into the theme surface at the theme's tint
 * strength. The text keeps the theme's colour. A colour that is not a hex value gets the plain bubble.
 */
export function robotTint(color: string | undefined): CSSProperties | undefined {
  return color !== undefined && COLOR.test(color) ? { background: `color-mix(in oklab, ${color} var(--tint), var(--surface))` } : undefined
}
