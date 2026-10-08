/**
 * What DSH's UI primitives import from @deepseek-ai/dsh-client-store, on Effect Atom (fe-3lfp, fe-mza0).
 * The primitives use createSnapshotStore only in their settings-form model, which Mr. Robot does not
 * render; Vite and Vitest resolve the package to this module so zustand and immer are not needed.
 */
import { atomSource, type AtomSource } from './atom-source.ts'

export function createSnapshotStore<A>(initial: A): AtomSource<A> & { readonly get: () => A } {
  const source = atomSource(initial)
  return { ...source, get: source.getSnapshot }
}
