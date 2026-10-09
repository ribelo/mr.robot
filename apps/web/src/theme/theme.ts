import type { ThemeChoice } from '@mr-robot/protocol'
import { resolveTheme, THEME_STORAGE_KEY, TOKENS } from './theme-css.ts'

const isChoice = (value: string | null): value is ThemeChoice => value === 'system' || value === 'light' || value === 'dark'

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isChoice(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

let current: ThemeChoice = 'system'
const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined

function paint(): void {
  const theme = resolveTheme(current, dark?.matches ?? true)
  document.documentElement.setAttribute('data-theme', theme)
  // The browser and phone chrome around the app take the theme's surface.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', TOKENS.themes[theme].color.surface)
  // The vendored DSH trajectory styles key off this body attribute.
  if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
  else document.body.removeAttribute('data-ds-dark-theme')
}

/** Apply a theme choice now and remember it for the next load (ap-itj1). */
export function applyTheme(choice: ThemeChoice): void {
  current = choice
  try { localStorage.setItem(THEME_STORAGE_KEY, choice) } catch { /* private mode: the choice lasts this session */ }
  paint()
}

/** Called once at startup: apply the remembered choice and follow the system while it is "system". */
export function startTheme(): void {
  current = storedTheme()
  paint()
  dark?.addEventListener('change', () => { if (current === 'system') paint() })
}
