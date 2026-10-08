import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// DSH's UI primitives import the DSH client store (zustand, immer); ours on Effect Atom stands in (fe-mza0).
const dshStore = { '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('./src/client/dsh-store-on-atom.ts', import.meta.url)) }

export default defineConfig({
  plugins: [react()],
  resolve: { alias: dshStore },
  test: {
    name: 'web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // DSH client packages ship CSS modules; let Vite process them instead of Node.
    server: { deps: { inline: [/@deepseek-ai\/dsh-client-/] } },
  },
})
