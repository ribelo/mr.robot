// Bundles the app for Electron (Node main process + preload); electron itself is provided by the runtime.
import { build } from 'esbuild'
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

mkdirSync('dist', { recursive: true })

// DSH's packages are ES modules that ask for their own place (import.meta.url) to find helper files and to load native modules.
// In one CommonJS bundle that place is the bundle itself, so native modules (koffi) and helpers must sit beside it.
const commonJs = {
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
}
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/main.cjs', external: ['electron'], sourcemap: true, ...commonJs })
await build({ entryPoints: ['src/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/preload.cjs', external: ['electron'] })
// A script that runs the Host's shell on its own, to check the bundle on a machine (see docs/hosts.md): node dist/shell-check.cjs
await build({ entryPoints: ['src/shell-check.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/shell-check.cjs', external: ['electron'], ...commonJs })
copyFileSync('src/window.html', 'dist/window.html')

// Linux: the Landlock launcher DSH falls back to when bubblewrap is not usable. It is a small static program that the bundle cannot
// contain, so it is copied beside the bundle (the app points DSH at it when it starts).
const requireFrom = (from, name) => createRequire(from).resolve(name)
try {
  const sandboxLocal = requireFrom(join(process.cwd(), 'package.json'), '@deepseek-ai/dsh-sandbox-local/package.json')
  const addon = requireFrom(sandboxLocal, '@deepseek-ai/node-addon-system/package.json')
  const launcher = join(dirname(requireFrom(addon, `@deepseek-ai/node-addon-system-${process.platform}-${process.arch}/package.json`)), 'bin', 'landlock-run')
  if (existsSync(launcher)) {
    copyFileSync(launcher, 'dist/landlock-run')
    chmodSync('dist/landlock-run', 0o755)
  }
} catch {
  // Not Linux, or no launcher for this CPU: the app then confines with bubblewrap or Seatbelt only.
}
