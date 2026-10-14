import type { FleetState } from '@mr-robot/protocol'

/**
 * A Robot's ball (ux-0zm6): a flat cartoon ball in the countryball way, a round body in the Robot's colour, eyes only,
 * clothes on it and props floating beside it. Everything here is pure: the same seed and colour always give the same look.
 */

export const EYE_STYLES = ['round', 'wide', 'dots', 'crosses', 'pixels', 'slits', 'mismatch', 'lens', 'plus', 'led'] as const
export type EyeStyle = (typeof EYE_STYLES)[number]

export const ACCESSORIES = ['none', 'antenna', 'twin antennae', 'headphones', 'visor', 'cap', 'beanie', 'bow', 'glasses', 'monocle', 'scarf', 'crown', 'propeller'] as const
export type Accessory = (typeof ACCESSORIES)[number]

export const MARKS = ['none', 'stripe', 'two-tone', 'pixel band', 'screen', 'bolt', 'rivets', 'circuit'] as const
export type Mark = (typeof MARKS)[number]

export const HIGHLIGHTS = ['none', 'shine', 'shine and dot', 'streak'] as const
export type Highlight = (typeof HIGHLIGHTS)[number]

export type Side = -1 | 1

/** The body colour of one ball, with its shade and its tint for marks and clothes. */
export interface BallColors {
  readonly body: string
  readonly dark: string
  readonly light: string
}

export interface BallLook {
  readonly colors: BallColors
  readonly eyes: EyeStyle
  /** The bigger eye of a mismatched pair. */
  readonly bigEye: Side
  /** Half the distance between the eye centres, in the 100-unit box. */
  readonly gap: number
  readonly eyeScale: number
  /** How far the eyes sit off centre, the way a countryball looks aside. */
  readonly face: number
  /** Eye height relative to the default line. */
  readonly eyeLevel: number
  readonly highlight: Highlight
  readonly accessory: Accessory
  readonly accessoryColor: string
  /** The side of a cap brim, a scarf end, a monocle or rivets. */
  readonly side: Side
  /** Degrees a crown or a bow is turned. */
  readonly tilt: number
  /** Where an antenna stands on the top of the ball. */
  readonly antennaX: number
  readonly mark: Mark
  readonly markColor: string
  /** The light of digital parts: LED pupils, a lens, a screen, eyes on a visor. */
  readonly glow: string
}

/** The face a fleet state puts on (ap-bxt2). A Robot shown without a state (a message, a preview) is awake. */
export type BallMood = 'awake' | 'focused' | 'drowsy' | 'asleep' | 'alert' | 'worried'

/** What floats beside the ball for a fleet state. */
export type BallProp = 'none' | 'thinking' | 'zzz' | 'blocked' | 'needs you'

export function ballMood(state: FleetState | undefined): BallMood {
  switch (state) {
    case 'working': return 'focused'
    case 'paused': return 'drowsy'
    case 'sleeping': case 'setup': return 'asleep'
    case 'waiting for you': return 'alert'
    case 'blocked': return 'worried'
    case undefined: return 'awake'
  }
}

export function ballProp(state: FleetState | undefined): BallProp {
  switch (state) {
    case 'working': return 'thinking'
    case 'sleeping': case 'setup': return 'zzz'
    case 'waiting for you': return 'needs you'
    case 'blocked': return 'blocked'
    case 'paused': case undefined: return 'none'
  }
}

export const INK = '#1b1b22'
export const EYE_WHITE = '#ffffff'
/** The dark glass of a visor, a screen or LED eyes. */
export const GLASS = '#1d2230'

const HEX = /^#[0-9a-fA-F]{6}$/
/** A colour that is not a six-digit hex value (the picker never writes one) draws a grey ball. */
const FALLBACK_BODY = '#9aa0a6'
const ACCESSORY_COLORS = ['#2b2d42', '#f7f5ee', '#ffd23f', '#e63946', '#3a86ff', '#2ec4b6', '#9b5de5', '#ff8fab', '#ff7f11'] as const
const GLOWS = ['#7df9ff', '#9dff6a', '#ffe66d', '#ff9de2'] as const

export function ballLook(seed: string, color: string): BallLook {
  const next = random(hash(seed))
  const body = HEX.test(color) ? color.toLowerCase() : FALLBACK_BODY
  const colors: BallColors = { body, dark: mix(body, '#000000', 0.32), light: mix(body, '#ffffff', 0.5) }
  // The draw order is fixed: changing it changes the look of every existing Robot.
  const eyes = pick(next, EYE_STYLES)
  const bigEye: Side = next() < 0.5 ? -1 : 1
  const gap = round(12.5 + next() * 3.5)
  const eyeScale = round(0.92 + next() * 0.22, 100)
  const face = round((next() - 0.5) * 10)
  const eyeLevel = round((next() - 0.5) * 6)
  const highlight = pick(next, HIGHLIGHTS)
  const accessory = pick(next, ACCESSORIES)
  const accessoryColor = contrasting(ACCESSORY_COLORS, Math.floor(next() * ACCESSORY_COLORS.length), body)
  const side: Side = next() < 0.5 ? -1 : 1
  const tilt = Math.round((next() - 0.5) * 24)
  const antennaX = round((next() - 0.5) * 16)
  const drawnMark = pick(next, MARKS)
  // A scarf covers the belly, where most marks sit.
  const mark: Mark = accessory === 'scarf' && drawnMark !== 'circuit' && drawnMark !== 'none' ? 'rivets' : drawnMark
  const markColor = contrasting([colors.dark, colors.light, INK, '#f7f5ee'], Math.floor(next() * 4), body, 60)
  const glow = pick(next, GLOWS)
  return { colors, eyes, bigEye, gap, eyeScale, face, eyeLevel, highlight, accessory, accessoryColor, side, tilt, antennaX, mark, markColor, glow }
}

/** FNV-1a over the UTF-16 code units of the seed. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

/** mulberry32: a small seeded generator, uniform on [0, 1). */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, items: readonly [T, ...T[]]): T {
  return items[Math.floor(next() * items.length)] ?? items[0]
}

function round(value: number, scale = 10): number {
  return Math.round(value * scale) / scale
}

/** The colour at `start` in the list, or the next one far enough from the body to stand out on it. */
function contrasting(colors: readonly string[], start: number, body: string, least = 110): string {
  for (let step = 0; step < colors.length; step += 1) {
    const candidate = colors[(start + step) % colors.length]!
    if (distance(candidate, body) > least) return candidate
  }
  return INK
}

function channels(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function distance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

/** `from` moved toward `to` by `amount` (0..1), per sRGB channel. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  return `#${a.map((value, index) => Math.round(value + (b[index]! - value) * amount).toString(16).padStart(2, '0')).join('')}`
}
