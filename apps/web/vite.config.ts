import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { KATEX_DIRECTORY, KATEX_VERSION, MERMAID_DIRECTORY, MERMAID_VERSION } from '../../packages/protocol/src/vendor.ts'
import { bootScript, tokenCss } from './src/theme/theme-css.ts'

/** The token CSS and the theme boot script go into index.html, so the first paint already has the right theme (ap-itj1). */
const themeTokens: Plugin = {
  name: 'mr-robot-theme-tokens',
  transformIndexHtml: () => [
    { tag: 'style', attrs: { id: 'theme-tokens' }, children: tokenCss(), injectTo: 'head-prepend' },
    { tag: 'script', children: bootScript, injectTo: 'head-prepend' },
  ],
}

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** The installed package's directory, after checking that its version is the one the Worker's Pages name (packages/protocol/src/vendor.ts). */
function installed(name: string, version: string): string {
  const directory = here(`./node_modules/${name}`)
  const found = (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { version: string }).version
  if (found !== version) throw new Error(`${name} ${found} is installed, but the Pages load ${version}: change packages/protocol/src/vendor.ts with the dependency`)
  return directory
}

/**
 * KaTeX's styles and fonts and Mermaid at /vendor/ (v1.17 review 3): a shared or printed Page loads them from the app's own origin, never from a
 * CDN. Only what a Page loads is copied: the minified CSS with its fonts, and Mermaid's ES module with its chunks, without source maps.
 */
const vendor: Plugin = {
  name: 'mr-robot-vendor',
  apply: 'build',
  closeBundle() {
    const out = here('./dist')
    const katex = join(installed('katex', KATEX_VERSION), 'dist')
    mkdirSync(join(out, KATEX_DIRECTORY), { recursive: true })
    cpSync(join(katex, 'katex.min.css'), join(out, KATEX_DIRECTORY, 'katex.min.css'))
    cpSync(join(katex, 'fonts'), join(out, KATEX_DIRECTORY, 'fonts'), { recursive: true })
    const mermaid = join(installed('mermaid', MERMAID_VERSION), 'dist')
    mkdirSync(join(out, MERMAID_DIRECTORY), { recursive: true })
    cpSync(join(mermaid, 'mermaid.esm.min.mjs'), join(out, MERMAID_DIRECTORY, 'mermaid.esm.min.mjs'))
    const chunks = join(mermaid, 'chunks', 'mermaid.esm.min')
    if (!existsSync(chunks)) throw new Error('mermaid has no chunks/mermaid.esm.min: its layout changed')
    cpSync(chunks, join(out, MERMAID_DIRECTORY, 'chunks', 'mermaid.esm.min'), { recursive: true, filter: (source) => !source.endsWith('.map') })
    if (readdirSync(join(out, MERMAID_DIRECTORY, 'chunks', 'mermaid.esm.min')).length === 0) throw new Error('no Mermaid chunks were copied')
  },
}

// DSH's UI primitives import the DSH client store (zustand, immer); ours on Effect Atom stands in (fe-mza0).
const dshStore = { '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('./src/client/dsh-store-on-atom.ts', import.meta.url)) }

export default defineConfig({
  plugins: [react(), themeTokens, vendor],
  resolve: { alias: dshStore },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
})
