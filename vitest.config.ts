import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['infra', 'apps/worker', 'apps/web', 'apps/host', 'packages/host-protocol'],
  },
})
