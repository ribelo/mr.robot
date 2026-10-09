import type { ThemeChoice } from '@mr-robot/protocol'
import tokens from './tokens.json'

export const TOKENS = tokens
export type ResolvedTheme = 'light' | 'dark'
export const THEME_STORAGE_KEY = 'mr-robot-theme'

const entries = (values: Record<string, string>, prefix: string) => Object.entries(values).map(([name, value]) => `  --${prefix}${name}: ${value};`)

const common = (): string[] => [
  ...entries(tokens.radius, 'radius-'),
  ...entries(tokens.space, 'space-'),
  ...entries(tokens.font, 'font-'),
]

const block = (selector: string, theme: ResolvedTheme): string => {
  const set = tokens.themes[theme]
  return [`${selector} {`, `  color-scheme: ${set.scheme};`, ...entries(set.color, ''), `  --tint: ${tokens.tint[theme]}%;`, '}'].join('\n')
}

/** The CSS variables of both themes, generated from tokens.json: dark is also the fallback before a theme attribute is set. */
export function tokenCss(): string {
  return [`:root {`, ...common(), '}', block(':root, [data-theme=dark]', 'dark'), block('[data-theme=light]', 'light')].join('\n') + '\n'
}

/** Every variable name the token file defines for a theme (sorted). */
export function definedVariables(theme: ResolvedTheme): string[] {
  const set = tokens.themes[theme]
  return [...Object.keys(set.color), 'tint', ...Object.keys(tokens.radius).map((n) => `radius-${n}`), ...Object.keys(tokens.space).map((n) => `space-${n}`), ...Object.keys(tokens.font).map((n) => `font-${n}`)].map((name) => `--${name}`).sort()
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
}

/** Inline script for index.html: sets data-theme from the stored choice before the first paint. */
export const bootScript = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=c==='dark'||((c!=='light')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}})()`
