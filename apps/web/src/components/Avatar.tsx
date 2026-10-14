import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { memberAvatarPath, type FleetState, type MemberAvatar } from '@mr-robot/protocol'
import { liven } from './robot-ball-life.ts'
import { ballLook, ballMood, ballProp, EYE_WHITE, GLASS, INK, mix, type BallLook, type BallMood, type BallProp, type Side } from './robot-ball.ts'

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

/**
 * A Robot's avatar (ux-0zm6): its ball, drawn from its seed in its colour, with the face and the prop of its fleet
 * state. A live ball (no reduced motion) follows the pointer with its pupils and blinks (robot-ball-life.ts).
 */
export function Avatar({ seed, color, size = 36, state }: { seed: string; color: string; size?: number; state?: FleetState }) {
  const still = useReducedMotion()
  const face = useRef<SVGSVGElement>(null)
  useEffect(() => (still || face.current === null ? undefined : liven(face.current)), [still])
  const mood = ballMood(state)
  const prop = ballProp(state)
  const drawing = useMemo(() => drawBall(ballLook(seed, color), mood, prop), [seed, color, mood, prop])
  // The drawing does not depend on the size; only the outline width does: about a pixel when small, thin when large.
  const ink: CSSProperties = { ['--ink' as string]: `${Math.max(3, Math.round(1100 / size) / 10)}px` }
  return (
    <span className={`avatar ${avatarStateClass(state)}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg ref={face} className={`avatar-face ball-${mood}${still ? '' : ' ball-live'}`} viewBox={VIEW_BOX} width={size} height={size} style={ink} data-seed={seed}>
        {drawing}
      </svg>
      {state === 'waiting for you' ? <span className="avatar-ring" /> : null}
    </span>
  )
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => motionQuery()?.matches ?? false, () => false)
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = motionQuery()
  if (query === undefined || typeof query.addEventListener !== 'function') return () => {}
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** The reduced-motion query, where the environment has one (not on the server, not in every test DOM). */
function motionQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : undefined
}

// ---------------------------------------------------------------- the drawing
// One 100-unit box with the ball's centre at the origin: the ball fills most of it, hats reach the top edge and the
// state props float in the top right corner. Outline widths come from --ink (set per size on the SVG).

const R = 40
const VIEW_BOX = '-50 -55 100 100'

/** A stroke width of k outlines (plus a fixed part), scaled with the avatar's size through --ink. */
const w = (k: number, plus = 0): CSSProperties => ({ strokeWidth: plus === 0 ? `calc(var(--ink) * ${k})` : `calc(var(--ink) * ${k} + ${plus}px)` })
const n = (value: number): number => Math.round(value * 10) / 10
const chord = (y: number): number => Math.sqrt(Math.max(0, R * R - y * y))

/** The part of the ball between two heights: a stripe, a hat, a scarf, without clipping. */
function band(top: number, bottom: number): string {
  const a = n(chord(top))
  const b = n(chord(bottom))
  return `M${-a} ${top}H${a}A${R} ${R} 0 0 1 ${b} ${bottom}H${-b}A${R} ${R} 0 0 1 ${-a} ${top}Z`
}

function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}Z`
}

/** Flat shading in the countryball way: a darker crescent on the lower right, between the ball and a smaller circle touching it top left. */
const SHADE = `${circlePath(0, 0, R)}${circlePath(-3.4, -4.2, R - Math.hypot(3.4, 4.2))}`

function drawBall(look: BallLook, mood: BallMood, prop: BallProp): ReactNode {
  const eyes = eyePair(look, mood)
  return (
    <>
      <g className="ball-body">
        {behind(look)}
        <circle r={R} fill={look.colors.body} />
        {mark(look)}
        <path d={SHADE} fill={INK} fillOpacity={0.16} fillRule="evenodd" />
        {highlight(look)}
        <circle r={R} fill="none" stroke={INK} style={w(1)} />
        {look.accessory === 'visor' ? visor(eyes.y) : null}
        {eyes.spots.map((spot) => <g key={spot.side}>{spot.drawing}</g>)}
        {front(look, eyes)}
        {mood === 'alert' || mood === 'worried' ? eyes.spots.map((spot) => <path key={`brow${spot.side}`} d={brow(spot, mood)} fill="none" stroke={INK} strokeLinecap="round" style={w(1, 0.4)} />) : null}
      </g>
      {prop === 'none' ? null : <g transform={PROP_SCALE}>{floating(prop)}</g>}
    </>
  )
}

// ---------------------------------------------------------------- eyes

type EyeShape =
  | { readonly kind: 'ellipse'; readonly rx: number; readonly ry: number; readonly pupil: number; readonly lens: boolean }
  | { readonly kind: 'box'; readonly width: number; readonly height: number; readonly corner: number; readonly pupil: number; readonly glass: boolean }
  | { readonly kind: 'glyph'; readonly glyph: 'dot' | 'cross' | 'plus'; readonly half: number }

const EYE_SHAPES: Record<BallLook['eyes'], EyeShape> = {
  round: { kind: 'ellipse', rx: 7, ry: 8.6, pupil: 3.3, lens: false },
  wide: { kind: 'ellipse', rx: 8.6, ry: 10.2, pupil: 3.2, lens: false },
  slits: { kind: 'ellipse', rx: 8.6, ry: 4.9, pupil: 2.7, lens: false },
  mismatch: { kind: 'ellipse', rx: 7, ry: 8.6, pupil: 3.2, lens: false },
  lens: { kind: 'ellipse', rx: 8, ry: 8, pupil: 4.4, lens: true },
  pixels: { kind: 'box', width: 12, height: 12, corner: 0, pupil: 5, glass: false },
  led: { kind: 'box', width: 11, height: 13.5, corner: 3.5, pupil: 5, glass: true },
  dots: { kind: 'glyph', glyph: 'dot', half: 4.4 },
  crosses: { kind: 'glyph', glyph: 'cross', half: 4.6 },
  plus: { kind: 'glyph', glyph: 'plus', half: 5 },
}

/** One drawn eye and the room it takes, for brows and glasses. */
interface EyeSpot {
  readonly side: Side
  readonly x: number
  readonly y: number
  readonly halfWidth: number
  readonly top: number
  readonly drawing: ReactNode
}

function eyePair(look: BallLook, mood: BallMood): { readonly y: number; readonly spots: readonly EyeSpot[] } {
  const y = n(-6 + look.eyeLevel)
  const shape = EYE_SHAPES[look.eyes]
  const spots = ([-1, 1] as const).map((side) => {
    const odd = look.eyes === 'mismatch' ? (side === look.bigEye ? 1.25 : 0.8) : 1
    const wide = mood === 'alert' || mood === 'worried' ? 1.1 : 1
    return eye(shape, look, mood, side, n(look.face + side * look.gap), y, look.eyeScale * odd * wide)
  })
  return { y, spots }
}

/** How much of an open eye the lid covers. */
function lidCut(mood: BallMood): number {
  switch (mood) {
    case 'focused': return 0.36
    case 'drowsy': return 0.55
    case 'awake': case 'alert': case 'worried': case 'asleep': return 0
  }
}

function eye(shape: EyeShape, look: BallLook, mood: BallMood, side: Side, x: number, y: number, scale: number): EyeSpot {
  const ink = look.accessory === 'visor' ? look.glow : INK
  const cut = lidCut(mood)
  switch (shape.kind) {
    case 'ellipse': {
      const rx = n(shape.rx * scale)
      const ry = n(shape.ry * scale)
      const drawing = mood === 'asleep' ? closedEye(x, y, rx, ink) : ellipseEye(x, y, rx, ry, shape.pupil * scale, cut, shape.lens ? look.glow : undefined)
      return { side, x, y, halfWidth: rx, top: y - ry, drawing }
    }
    case 'box': {
      const width = n(shape.width * scale)
      const height = n(shape.height * scale)
      const drawing = mood === 'asleep' ? closedEye(x, y, width / 2, ink) : boxEye(x, y, width, height, shape.corner, shape.pupil * scale, cut, shape.glass ? look.glow : undefined)
      return { side, x, y, halfWidth: width / 2, top: y - height / 2, drawing }
    }
    case 'glyph': {
      const half = n(shape.half * scale)
      const drawing = mood === 'asleep' ? closedEye(x, y, half * 1.15, ink) : glyphEye(x, y, half, 1 - cut * 1.0, shape.glyph, ink)
      return { side, x, y, halfWidth: half, top: y - half, drawing }
    }
  }
}

/** The pupils move inside the eye by --ax and --ay at most (see .ball-look in styles.css). */
function reach(ax: number, ay: number): CSSProperties {
  return { ['--ax' as string]: `${n(Math.max(0, ax))}px`, ['--ay' as string]: `${n(Math.max(0, ay))}px` }
}

function ellipseEye(x: number, y: number, rx: number, ry: number, pupil: number, cut: number, lens: string | undefined): ReactNode {
  const top = y - ry + cut * 2 * ry
  const lidHalf = rx * Math.sqrt(Math.max(0, 1 - ((top - y) / ry) ** 2))
  const white = cut === 0
    ? <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={EYE_WHITE} stroke={INK} style={w(0.85)} />
    : <path d={`M${n(x - lidHalf)} ${n(top)}H${n(x + lidHalf)}A${rx} ${ry} 0 ${top < y ? 1 : 0} 1 ${n(x - lidHalf)} ${n(top)}Z`} fill={EYE_WHITE} stroke={INK} strokeLinejoin="round" style={w(0.85)} />
  const bottom = y + ry
  const py = cut === 0 ? y : Math.max(y, top + pupil * 0.9 + 1.3)
  const r = Math.max(1.2, Math.min(cut === 0 ? pupil : pupil * 0.9, bottom - 1 - py))
  const halfAt = rx * Math.sqrt(Math.max(0, 1 - ((py - y) / ry) ** 2))
  return (
    <g className="ball-eye">
      {white}
      <g className="ball-look" style={reach(halfAt - r - 1.4, Math.min(py - r - top - 1, bottom - py - r - 1.4))}>
        <circle cx={x} cy={n(py)} r={n(r)} fill={INK} />
        {lens === undefined ? null : <circle cx={x} cy={n(py)} r={n(r * 0.48)} fill={lens} />}
      </g>
      {cut === 0 ? null : <path d={`M${n(x - lidHalf)} ${n(top)}H${n(x + lidHalf)}`} stroke={INK} strokeLinecap="round" style={w(1.1)} />}
    </g>
  )
}

function boxEye(x: number, y: number, width: number, height: number, corner: number, pupil: number, cut: number, glass: string | undefined): ReactNode {
  const top = y - height / 2 + cut * height
  const bottom = y + height / 2
  const side = Math.min(pupil, bottom - top - 2.4)
  const py = Math.max(y, top + side / 2 + 1.2)
  return (
    <g className="ball-eye">
      <rect x={n(x - width / 2)} y={n(top)} width={width} height={n(bottom - top)} rx={Math.min(corner, (bottom - top) / 2)} fill={glass === undefined ? EYE_WHITE : GLASS} stroke={INK} style={w(0.85)} />
      <g className="ball-look ball-look-pixel" style={reach(width / 2 - side / 2 - 1.4, Math.min(py - side / 2 - top - 1.2, bottom - py - side / 2 - 1.4))}>
        <rect x={n(x - side / 2)} y={n(py - side / 2)} width={n(side)} height={n(side)} rx={glass === undefined ? 0 : n(side / 4)} fill={glass ?? INK} />
      </g>
    </g>
  )
}

function glyphEye(x: number, y: number, half: number, squash: number, glyph: 'dot' | 'cross' | 'plus', ink: string): ReactNode {
  const tall = n(half * squash)
  const at = n(y + (half - tall) * 0.5)
  const drawing = glyph === 'dot'
    ? <ellipse cx={x} cy={at} rx={n(half * 0.82)} ry={tall} fill={ink} />
    : <path d={glyph === 'cross' ? `M${n(x - half)} ${n(at - tall)}L${n(x + half)} ${n(at + tall)}M${n(x + half)} ${n(at - tall)}L${n(x - half)} ${n(at + tall)}` : `M${n(x - half)} ${at}H${n(x + half)}M${x} ${n(at - tall)}V${n(at + tall)}`} stroke={ink} strokeLinecap="round" style={w(1, 1)} />
  return (
    <g className="ball-eye">
      <g className="ball-look" style={reach(2.2, 1.8 * squash)}>{drawing}</g>
    </g>
  )
}

/** Closed eyes, a soft "– –". */
function closedEye(x: number, y: number, half: number, ink: string): ReactNode {
  return <path d={`M${n(x - half * 0.9)} ${n(y + 1)}Q${x} ${n(y + 4)} ${n(x + half * 0.9)} ${n(y + 1)}`} fill="none" stroke={ink} strokeLinecap="round" style={w(1, 0.6)} />
}

/** Raised brows: arched for "needs you", worried (inner ends up) for blocked. */
function brow(spot: EyeSpot, mood: BallMood): string {
  const { x, top, halfWidth: half, side } = spot
  return mood === 'alert'
    ? `M${n(x - half)} ${n(top - 3.5)}Q${x} ${n(top - 9)} ${n(x + half)} ${n(top - 3.5)}`
    : `M${n(x + side * half)} ${n(top - 3.2)}Q${x} ${n(top - 5.2)} ${n(x - side * half * 0.9)} ${n(top - 8.6)}`
}

// ---------------------------------------------------------------- body

function highlight(look: BallLook): ReactNode {
  switch (look.highlight) {
    case 'none': return null
    case 'shine': return <ellipse cx={-15} cy={-21} rx={8} ry={4.6} transform="rotate(-32 -15 -21)" fill="#ffffff" fillOpacity={0.42} />
    case 'shine and dot': return (
      <>
        <ellipse cx={-15} cy={-21} rx={8} ry={4.6} transform="rotate(-32 -15 -21)" fill="#ffffff" fillOpacity={0.42} />
        <circle cx={-26} cy={-9} r={2.4} fill="#ffffff" fillOpacity={0.42} />
      </>
    )
    case 'streak': return <path d="M-30.1 -10.9A32 32 0 0 1 -13.5 -29" fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeLinecap="round" strokeWidth={4.2} />
  }
}

function mark(look: BallLook): ReactNode {
  const color = look.markColor
  const s = look.side
  switch (look.mark) {
    case 'none': return null
    case 'stripe': return <path d={band(9, 18)} fill={color} />
    case 'two-tone': return <path d={band(13, R)} fill={color} />
    case 'pixel band': {
      const other = color === look.colors.light ? look.colors.dark : look.colors.light
      return [0, 1].flatMap((row) => [0, 1, 2, 3, 4, 5, 6, 7].map((column) => (
        <rect key={`${row}-${column}`} x={-24 + column * 6} y={12 + row * 6} width={6} height={6} fill={(row + column) % 2 === 0 ? color : other} />
      )))
    }
    case 'screen': return (
      <>
        <rect x={-12} y={11} width={24} height={15} rx={3} fill={GLASS} stroke={INK} style={w(0.7)} />
        <path d="M-8 19l3-4 3 7 3-6 3 3 3-1h2" fill="none" stroke={look.glow} strokeLinecap="round" strokeLinejoin="round" style={w(0.45, 0.6)} />
      </>
    )
    case 'bolt': return <path d={`M${3 + s * 5} 7L${-8 + s * 5} 22H${-1 + s * 5}L${-5 + s * 5} 35L${9 + s * 5} 17H${2 + s * 5}L${7 + s * 5} 7Z`} fill={color} stroke={INK} strokeLinejoin="round" style={w(0.6)} />
    case 'rivets': return [[27, 5], [31, 13], [24, 20], [19, 12]].map(([x, y]) => <circle key={`${x}`} cx={s * x!} cy={y} r={2.5} fill={color} />)
    case 'circuit': return (
      <g fill={color}>
        <path d={`M${s * -37} 6H${s * -24}L${s * -17} 13H${s * -7}M${s * -34} 20H${s * -23}L${s * -18} 25`} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" style={w(0.6, 0.6)} />
        <circle cx={s * -7} cy={13} r={2.4} />
        <circle cx={s * -18} cy={25} r={2.4} />
      </g>
    )
  }
}

// ---------------------------------------------------------------- clothes

/** Parts that stand behind the ball: the stick of an antenna, the band of headphones, the pompom of a beanie. */
function behind(look: BallLook): ReactNode {
  const color = look.accessoryColor
  switch (look.accessory) {
    case 'antenna': {
      const tip = n(look.antennaX * 1.35)
      return stick(`M${look.antennaX} -30L${tip} -47`, look.accessoryColor)
    }
    case 'twin antennae': return stick('M-8 -30L-16 -45M8 -30L16 -45', look.accessoryColor)
    case 'headphones': return (
      <>
        <path d="M-41 -4C-41 -60 41 -60 41 -4" fill="none" stroke={INK} style={w(2.6)} />
        <path d="M-41 -4C-41 -60 41 -60 41 -4" fill="none" stroke={color} style={w(1.1)} />
      </>
    )
    case 'beanie': return <circle cx={0} cy={-44} r={5.5} fill={mix(color, '#ffffff', 0.35)} stroke={INK} style={w(0.8)} />
    case 'propeller': return stick('M0 -36V-47', look.accessoryColor)
    case 'none': case 'visor': case 'cap': case 'bow': case 'glasses': case 'monocle': case 'scarf': case 'crown': return null
  }
}

/** A stick in ink with a coloured core, so it shows on dark surfaces too. */
function stick(d: string, color: string): ReactNode {
  return (
    <>
      <path d={d} stroke={INK} strokeLinecap="round" style={w(1.9, 0.4)} />
      <path d={d} stroke={color} strokeLinecap="round" style={w(0.7, 0.2)} />
    </>
  )
}

function visor(eyeY: number): ReactNode {
  return (
    <>
      <path d={band(eyeY - 12.5, eyeY + 11.5)} fill={GLASS} stroke={INK} strokeLinejoin="round" style={w(0.8)} />
      <path d={`M-26 ${n(eyeY - 8)}H-16`} stroke="#ffffff" strokeOpacity={0.3} strokeLinecap="round" style={w(0.5, 0.5)} />
    </>
  )
}

/** Parts in front of the ball: hats, glasses, scarf, the tips of antennae, the cups of headphones. */
function front(look: BallLook, eyes: { readonly y: number; readonly spots: readonly EyeSpot[] }): ReactNode {
  const color = look.accessoryColor
  const outline = { stroke: INK, strokeLinejoin: 'round' as const, style: w(0.85) }
  const s = look.side
  switch (look.accessory) {
    case 'none': case 'visor': return null
    case 'antenna': return antennaTip(n(look.antennaX * 1.35), -48.5, 3.6, color)
    case 'twin antennae': return <>{antennaTip(-16.5, -46, 3, color)}{antennaTip(16.5, -46, 3, color)}</>
    case 'headphones': return <><rect x={-47} y={-15} width={11} height={22} rx={4.5} fill={color} {...outline} /><rect x={36} y={-15} width={11} height={22} rx={4.5} fill={color} {...outline} /></>
    case 'cap': return (
      <>
        <path d={band(-R, -24)} fill={color} {...outline} />
        <ellipse cx={s * 29} cy={-23.5} rx={15} ry={4.2} fill={color} {...outline} />
        <circle cx={0} cy={-40} r={2.6} fill={color} {...outline} />
      </>
    )
    case 'beanie': return (
      <>
        <path d={band(-R, -22)} fill={color} {...outline} />
        <path d={band(-27, -20)} fill={mix(color, INK, 0.25)} {...outline} />
      </>
    )
    case 'bow': return (
      <g transform={`rotate(${look.tilt - 20} -25 -31)`} fill={color} {...outline}>
        <path d="M-25 -31l-11 -7v14z" />
        <path d="M-25 -31l11 -7v14z" />
        <circle cx={-25} cy={-31} r={3.6} />
      </g>
    )
    case 'glasses': {
      const [left, right] = eyes.spots
      if (left === undefined || right === undefined) return null
      const ring = (spot: EyeSpot) => n(Math.max(spot.halfWidth, spot.y - spot.top) + 3.4)
      const edge = n(chord(eyes.y) - 1)
      return (
        <g fill="none" stroke={INK} strokeLinecap="round" style={w(0.9)}>
          <circle cx={left.x} cy={eyes.y} r={ring(left)} fill="#ffffff" fillOpacity={0.16} />
          <circle cx={right.x} cy={eyes.y} r={ring(right)} fill="#ffffff" fillOpacity={0.16} />
          <path d={`M${n(left.x + ring(left))} ${eyes.y}Q${look.face} ${n(eyes.y - 4)} ${n(right.x - ring(right))} ${eyes.y}M${n(left.x - ring(left))} ${eyes.y}H${-edge}M${n(right.x + ring(right))} ${eyes.y}H${edge}`} />
        </g>
      )
    }
    case 'monocle': {
      const spot = eyes.spots.find((candidate) => candidate.side === s)
      if (spot === undefined) return null
      const r = n(Math.max(spot.halfWidth, spot.y - spot.top) + 3.6)
      return (
        <g fill="none" strokeLinecap="round">
          <path d={`M${spot.x} ${n(eyes.y + r)}Q${n(spot.x + s * 10)} ${n(eyes.y + r + 12)} ${n(spot.x + s * 4)} 30`} stroke="#e3b341" style={w(0.55, 0.3)} />
          <circle cx={spot.x} cy={eyes.y} r={r} stroke={INK} style={w(1.9)} />
          <circle cx={spot.x} cy={eyes.y} r={r} stroke="#e3b341" fill="#ffffff" fillOpacity={0.14} style={w(0.9)} />
        </g>
      )
    }
    case 'scarf': return (
      <>
        <rect x={s * 15 - 4.5} y={22} width={9} height={20} rx={2.5} transform={`rotate(${-s * 14} ${s * 15} 24)`} fill={mix(color, INK, 0.12)} {...outline} />
        <path d={band(19, 29)} fill={color} {...outline} />
      </>
    )
    case 'crown': return (
      <g transform={`rotate(${look.tilt} 0 -38)`}>
        <path d="M-11 -35V-46L-5.5 -40.5L0 -49.5L5.5 -40.5L11 -46V-35Z" fill="#f4c430" {...outline} />
        <circle cx={0} cy={-38.5} r={1.9} fill="#e63946" />
      </g>
    )
    case 'propeller': return (
      <>
        <path d={band(-R, -31)} fill={color} {...outline} />
        <g className="ball-spin">
          <ellipse cx={-6.5} cy={-48} rx={6.5} ry={2.3} fill={color} {...outline} />
          <ellipse cx={6.5} cy={-48} rx={6.5} ry={2.3} fill={mix(color, '#ffffff', 0.5)} {...outline} />
        </g>
        <circle cx={0} cy={-48} r={1.7} fill={INK} />
      </>
    )
  }
}

function antennaTip(x: number, y: number, r: number, color: string): ReactNode {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={color} stroke={INK} style={w(0.8)} />
      <circle className="ball-tip" cx={x} cy={y} r={n(r * 0.55)} fill="#ffffff" />
    </>
  )
}

// ---------------------------------------------------------------- props

/** Props grow out of the box toward the top right from where they touch the ball, so they still read at 22 px. */
const PROP_SCALE = 'translate(20 -36) scale(1.4) translate(-20 36)'

/** The "z" of a sleeping ball: an ink stroke with a white core, readable on light and dark surfaces. */
function zee(x: number, y: number, size: number): ReactNode {
  const d = `M${x} ${y}h${size}l${-size} ${size}h${size}`
  return (
    <g className="ball-z">
      <path d={d} fill="none" stroke={INK} strokeLinecap="round" strokeLinejoin="round" style={w(1.9, 0.6)} />
      <path d={d} fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round" style={w(0.8, 0.2)} />
    </g>
  )
}

function bang(className: string, color: string): ReactNode {
  return (
    <g className={`ball-prop ${className}`} fill={color} stroke={INK} strokeLinejoin="round" style={w(0.8)}>
      <path d="M35.5 -54H44.5L43 -40H37Z" />
      <circle cx={40} cy={-33.5} r={3.3} />
    </g>
  )
}

function floating(prop: BallProp): ReactNode {
  switch (prop) {
    case 'none': return null
    case 'thinking': return (
      <g className="ball-prop ball-thinking">
        <rect x={18} y={-54} width={30} height={17} rx={8.5} fill="#ffffff" stroke={INK} style={w(0.8)} />
        {[25.5, 33, 40.5].map((x) => <circle key={x} className="ball-dot" cx={x} cy={-45.5} r={2.6} fill={INK} />)}
      </g>
    )
    case 'zzz': return <g className="ball-prop ball-zzz">{zee(23, -39, 7)}{zee(34, -53, 10)}</g>
    // The blocked mark keeps the class the fleet-state look has used since ap-bxt2.
    case 'blocked': return bang('avatar-mark', '#e5484d')
    case 'needs you': return bang('ball-alert', '#f0a23b')
  }
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
