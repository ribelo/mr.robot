import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'infra',
    include: ['**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // The plan test never reaches Cloudflare: a throwaway Alchemy home and placeholder credentials
    // keep it away from the owner's profiles (Alchemy migrates whatever home it opens).
    env: { ALCHEMY_HOME: '/tmp/mr-robot-plan-test-alchemy', CLOUDFLARE_API_TOKEN: 'plan-test', CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000', ALCHEMY_PROFILE: 'plan-test' },
  },
})