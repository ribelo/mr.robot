import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

/** Real Cloudflare services; needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './test/integration/wrangler.jsonc' } })],
  test: { include: ['test/integration/**/*.integration.test.ts'], testTimeout: 120_000 },
})
