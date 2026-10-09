import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { bootScript, tokenCss } from './src/theme/theme-css.ts'

/** The token CSS and the theme boot script go into index.html, so the first paint already has the right theme (ap-itj1). */
const themeTokens: Plugin = {
  name: 'mr-robot-theme-tokens',
  transformIndexHtml: () => [
    { tag: 'style', attrs: { id: 'theme-tokens' }, children: tokenCss(), injectTo: 'head-prepend' },
    { tag: 'script', children: bootScript, injectTo: 'head-prepend' },
  ],
}

// DSH's UI primitives import the DSH client store (zustand, immer); ours on Effect Atom stands in (fe-mza0).
const dshStore = { '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('./src/client/dsh-store-on-atom.ts', import.meta.url)) }

export default defineConfig({
  plugins: [react(), themeTokens],
  resolve: { alias: dshStore },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
})
