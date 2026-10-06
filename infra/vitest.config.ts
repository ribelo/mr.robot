import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'infra',
    include: ['**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // The plan test never reaches Cloudflare; placeholder credentials keep it off the owner's profile.
    env: { CLOUDFLARE_API_TOKEN: 'plan-test', CLOUDFLARE_ACCOUNT_ID: '00000000000000000000000000000000', ALCHEMY_PROFILE: 'plan-test' },
  },
})
