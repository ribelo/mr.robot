/**
 * The libraries a rendered Page loads from the app's own origin (v1.17 review 3): KaTeX's styles and fonts, and Mermaid. The web build copies them
 * from the installed packages to these paths (apps/web/vite.config.ts) and fails when the installed versions are not these; /vendor/* is public, so a
 * shared Page and Browser Rendering reach it, and nothing public depends on an outside CDN.
 */
export const KATEX_VERSION = '0.16.47'
export const MERMAID_VERSION = '12.2.0'

export const VENDOR_DIRECTORY = 'vendor'
export const KATEX_DIRECTORY = `${VENDOR_DIRECTORY}/katex-${KATEX_VERSION}`
export const MERMAID_DIRECTORY = `${VENDOR_DIRECTORY}/mermaid-${MERMAID_VERSION}`

/** Paths from the origin's root. */
export const KATEX_CSS_PATH = `/${KATEX_DIRECTORY}/katex.min.css`
export const MERMAID_MODULE_PATH = `/${MERMAID_DIRECTORY}/mermaid.esm.min.mjs`
