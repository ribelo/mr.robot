import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// DSH's UI primitives import the DSH client store (zustand, immer); ours on Effect Atom stands in (fe-mza0).
const dshStore = { '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('./src/client/dsh-store-on-atom.ts', import.meta.url)) }

export default defineConfig({
  plugins: [react()],
  resolve: { alias: dshStore },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
})
