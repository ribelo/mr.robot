/**
 * A value outside React, published through Effect Atom (fe-r2kx): the DSH conversation assembler's
 * group and location sources and the trajectory preferences use it instead of the DSH client store.
 */
import { Atom, AtomRegistry } from 'effect/reactivity'

/** The registry for values owned by plain classes (the assembler); React reads them via subscribe. */
const outsideRegistry = AtomRegistry.make()

/** What a view reads: the current value and a change notification. */
export interface ObservableSnapshot<A> {
  readonly getSnapshot: () => A
  readonly subscribe: (listener: () => void) => () => void
}

export interface AtomSource<A> extends ObservableSnapshot<A> {
  readonly set: (value: A) => void
}

/** A value with its own atom; set notifies every subscriber whose value changed. */
export function atomSource<A>(initial: A): AtomSource<A> {
  const atom = Atom.make(initial).pipe(Atom.keepAlive)
  return {
    getSnapshot: () => outsideRegistry.get(atom),
    subscribe: (listener) => outsideRegistry.subscribe(atom, listener),
    set: (value) => outsideRegistry.set(atom, value),
  }
}

/** A browser-wide boolean preference kept in localStorage under name (trajectory duration, string wrapping). */
export function persistedPreference(name: string, fallback: boolean): AtomSource<boolean> {
  const stored = readStored(name)
  const source = atomSource(stored ?? fallback)
  return {
    ...source,
    set: (value) => {
      try { localStorage.setItem(name, JSON.stringify(value)) } catch { /* private mode: keep it for this page */ }
      source.set(value)
    },
  }
}

function readStored(name: string): boolean | undefined {
  try {
    const raw = localStorage.getItem(name)
    if (raw === null) return undefined
    const value: unknown = JSON.parse(raw)
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}
