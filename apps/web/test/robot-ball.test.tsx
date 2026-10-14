import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FleetState } from '@mr-robot/protocol'
import { Avatar } from '../src/components/Avatar.tsx'
import { ballLook } from '../src/components/robot-ball.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const drawing = (seed: string, size = 34, state?: FleetState) => {
  const { container } = render(<Avatar seed={seed} color="#5ec4b6" size={size} state={state} />)
  const face = container.querySelector('svg.avatar-face')!
  const html = { face: face.innerHTML, whole: container.innerHTML }
  cleanup()
  return html
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

describe('Robot balls (ux-0zm6)', () => {
  it('draws the same ball for the same seed, at every size', () => {
    expect(drawing('robot-a').whole).toBe(drawing('robot-a').whole)
    expect(drawing('robot-a', 22).face).toBe(drawing('robot-a', 96).face)
  })

  it('draws clearly different balls for different seeds', () => {
    const seeds = Array.from({ length: 20 }, (_, index) => `robot-${index}`)
    expect(new Set(seeds.map((seed) => drawing(seed).face)).size).toBe(20)
    const looks = seeds.map((seed) => ballLook(seed, '#5ec4b6'))
    expect(new Set(looks.map((look) => look.eyes)).size).toBeGreaterThanOrEqual(6)
    expect(new Set(looks.map((look) => look.accessory)).size).toBeGreaterThanOrEqual(7)
    expect(new Set(looks.map((look) => `${look.eyes} ${look.accessory} ${look.mark}`)).size).toBeGreaterThanOrEqual(18)
  })

  it('shows each fleet state on the ball', () => {
    const at = (state: FleetState | undefined) => render(<Avatar seed="robot-a" color="#5ec4b6" state={state} />).container
    const marks: readonly [FleetState | undefined, string][] = [
      ['working', '.ball-focused .ball-thinking'], ['sleeping', '.ball-asleep .ball-zzz'], ['setup', '.ball-asleep .ball-zzz'],
      ['waiting for you', '.ball-alert'], ['blocked', '.ball-worried .avatar-mark'], ['paused', '.ball-drowsy'], [undefined, '.ball-awake'],
    ]
    for (const [state, selector] of marks) {
      const container = at(state)
      expect(container.querySelector(selector), String(state)).not.toBeNull()
      // A ball without a state (a message, a preview) and a paused one float nothing beside them.
      if (state === undefined || state === 'paused') expect(container.querySelector('.ball-prop')).toBeNull()
      cleanup()
    }
    expect(at('waiting for you').querySelector('.avatar-ring')).not.toBeNull()
  })

  it('follows the pointer with its pupils, and holds still under reduced motion', async () => {
    const pointAt = (container: HTMLElement) => {
      const face = container.querySelector<SVGSVGElement>('svg.avatar-face')!
      face.getBoundingClientRect = () => ({ left: 0, top: 0, right: 34, bottom: 34, width: 34, height: 34, x: 0, y: 0, toJSON: () => ({}) })
      fireEvent.pointerMove(document, { clientX: 400, clientY: 17 })
      return face
    }
    stubReducedMotion(false)
    const live = pointAt(render(<Avatar seed="robot-a" color="#5ec4b6" size={34} state="working" />).container)
    expect(live.classList.contains('ball-live')).toBe(true)
    await waitFor(() => expect(live.style.getPropertyValue('--lx')).toBe('1.00'))
    cleanup()
    stubReducedMotion(true)
    const still = pointAt(render(<Avatar seed="robot-a" color="#5ec4b6" size={34} state="working" />).container)
    expect(still.classList.contains('ball-live')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(still.style.getPropertyValue('--lx')).toBe('')
    // The state still shows, without motion.
    expect(still.querySelector('.ball-thinking')).not.toBeNull()
  })
})
