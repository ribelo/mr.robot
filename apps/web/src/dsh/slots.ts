/** Local equivalents of the DSH ui-slots helper types the trajectory uses. */
import type { ReactNode } from 'react'

export type Translate = (key: string, params?: Record<string, unknown>) => string
export type TranslateNS<_N extends string = string> = import('./trajectory/locales.ts').TrajectoryTranslate
export type PropsLocale<_N extends string = string> = { t: Translate }
export type SnapshotSelectorHook<T> = <S>(select: (snapshot: T) => S) => S
export type PropsRenderSlots<_S extends string = string> = { renderSlot: (key: string, owner: object) => ReactNode }
