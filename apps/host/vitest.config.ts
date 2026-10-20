import { defineConfig } from 'vitest/config'

// Every Host file change starts a sandboxed process (v1.16 deep P1), so a copy test under the full suite's load needs more than 5 s.
export default defineConfig({ test: { name: 'host', include: ['test/**/*.test.ts'], testTimeout: 30_000 } })
