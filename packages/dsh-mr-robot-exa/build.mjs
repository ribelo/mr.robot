// The same plugin module the Worker mounts, bundled for the desktop harness; schemastery comes from the host.
import { build } from 'esbuild'

await build({
  entryPoints: ['../../apps/worker/src/plugins/exa.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: 'dist/index.js',
  external: ['@deepseek-ai/schemastery'],
})
