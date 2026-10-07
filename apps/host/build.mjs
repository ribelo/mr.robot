// Bundles the app for Electron (Node main process + preload); electron itself is provided by the runtime.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/main.cjs', external: ['electron'], sourcemap: true })
await build({ entryPoints: ['src/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/preload.cjs', external: ['electron'] })
copyFileSync('src/window.html', 'dist/window.html')
