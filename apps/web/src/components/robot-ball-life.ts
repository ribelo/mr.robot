/**
 * The life of drawn Robot balls (ux-0zm6): pupils follow the pointer and the eyes blink now and then. This is the
 * imperative shell around the pure drawing: one document-level pointer listener for every ball on the page, writing
 * CSS variables (--lx, --ly) straight onto each ball's SVG, so React never re-renders for it. The stylesheet turns the
 * variables into pupil movement and the blink class into closed lids.
 */

const live = new Set<SVGSVGElement>()
const blinks = new Map<SVGSVGElement, ReturnType<typeof setTimeout>>()
let pointer: { readonly x: number; readonly y: number } | undefined
let frame: number | undefined
let lastLook = 0
/** At most one look per this many milliseconds, however fast the pointer moves. */
const LOOK_EVERY = 40
const BLINK_LENGTH = 140

/** Starts the life of one drawn ball; the returned function stops it. */
export function liven(face: SVGSVGElement): () => void {
  live.add(face)
  if (live.size === 1) document.addEventListener('pointermove', onPointerMove, { passive: true })
  if (pointer !== undefined) look([face], pointer)
  scheduleBlink(face)
  return () => {
    live.delete(face)
    clearTimeout(blinks.get(face))
    blinks.delete(face)
    if (live.size === 0) {
      document.removeEventListener('pointermove', onPointerMove)
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
    }
  }
}

function onPointerMove(event: PointerEvent): void {
  pointer = { x: event.clientX, y: event.clientY }
  requestLook()
}

function requestLook(): void {
  if (frame === undefined) frame = requestAnimationFrame(onFrame)
}

function onFrame(now: number): void {
  frame = undefined
  if (now - lastLook < LOOK_EVERY) return requestLook()
  lastLook = now
  if (pointer !== undefined) look([...live], pointer)
}

/** Turns each ball's eyes toward the point: all layout reads first, then all style writes. */
function look(faces: readonly SVGSVGElement[], at: { readonly x: number; readonly y: number }): void {
  const height = window.innerHeight
  const gazes = faces.map((face) => {
    const box = face.getBoundingClientRect()
    if (box.width === 0 || box.bottom < 0 || box.top > height) return undefined
    const dx = at.x - (box.left + box.width / 2)
    const dy = at.y - (box.top + box.height / 2)
    // Far away the eyes point straight at the pointer; over the ball they follow it proportionally.
    const reach = Math.max(Math.hypot(dx, dy), box.width * 1.5)
    return { face, x: (dx / reach).toFixed(2), y: (dy / reach).toFixed(2) }
  })
  for (const gaze of gazes) {
    if (gaze === undefined) continue
    gaze.face.style.setProperty('--lx', gaze.x)
    gaze.face.style.setProperty('--ly', gaze.y)
  }
}

/** A blink every 3 to 7 seconds, at its own random moment for each ball. */
function scheduleBlink(face: SVGSVGElement): void {
  blinks.set(face, setTimeout(() => {
    face.classList.add('ball-blinking')
    blinks.set(face, setTimeout(() => {
      face.classList.remove('ball-blinking')
      if (live.has(face)) scheduleBlink(face)
    }, BLINK_LENGTH))
  }, 3000 + Math.random() * 4000))
}
