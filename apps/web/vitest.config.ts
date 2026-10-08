import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // DSH client packages ship CSS modules; let Vite process them instead of Node.
    server: { deps: { inline: [/@deepseek-ai\/dsh-client-/] } },
  },
})
