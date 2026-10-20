// Bundles the app for Electron (Node main process + preload); electron itself is provided by the runtime.
import { build } from 'esbuild'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// "node build.mjs --windows" builds what the Windows installer packs (pnpm dist:win); without it the bundle is for this computer.
const windows = process.argv.includes('--windows')

mkdirSync('dist', { recursive: true })

// DSH's packages are ES modules that ask for their own place (import.meta.url) to find helper files and to load native modules.
// In one CommonJS bundle that place is the bundle itself, so native modules (koffi) and helpers must sit beside it.
// DSH also asks import.meta.resolve for its two helper programs on Windows (the process runner and the ACL runner); they are built below
// as files beside the bundle, and this answers for them.
const RUNNERS = { '@deepseek-ai/dsh-subprocess-local/runner': 'runners/subprocess-runner.mjs', '@deepseek-ai/dsh-sandbox-windows-acl/runner': 'runners/acl-runner.mjs' }
const commonJs = {
  define: { 'import.meta.url': '__importMetaUrl', 'import.meta.resolve': '__importMetaResolve' },
  banner: {
    js: `const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;
const __importMetaResolve = (specifier) => {
  const runner = ${JSON.stringify(RUNNERS)}[specifier];
  if (runner === undefined) throw new Error('mr-robot-host: cannot resolve ' + specifier);
  return require('node:url').pathToFileURL(require('node:path').join(__dirname, runner)).href;
};`,
  },
}
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/main.cjs', external: ['electron'], sourcemap: true, ...commonJs })
await build({ entryPoints: ['src/preload.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/preload.cjs', external: ['electron'] })
// A script that runs the Host's shell on its own, to check the bundle on a machine (see docs/hosts.md): node dist/shell-check.cjs
await build({ entryPoints: ['src/shell-check.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'dist/shell-check.cjs', external: ['electron'], ...commonJs })
copyFileSync('src/window.html', 'dist/window.html')

if (windows) {
  // The helper programs, as ES modules of their own: Electron starts them as plain Node (ELECTRON_RUN_AS_NODE, see src/windows.ts).
  // They look for koffi beside themselves, like the bundle does.
  const requireFrom = (from, name) => createRequire(from).resolve(name)
  const own = join(process.cwd(), 'package.json')
  const runnerBanner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  for (const [name, entry] of Object.entries({ 'subprocess-runner': '@deepseek-ai/dsh-subprocess-local/runner', 'acl-runner': '@deepseek-ai/dsh-sandbox-windows-acl/runner' })) {
    await build({ entryPoints: [requireFrom(own, entry)], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: `dist/runners/${name}.mjs`, external: ['electron'], banner: { js: runnerBanner } })
  }
  // koffi (DSH's Win32 calls) is a native module that no bundle can hold: it ships as files, with its Windows binary.
  const koffiEntry = requireFrom(requireFrom(own, '@deepseek-ai/dsh-sandbox-windows-acl/package.json'), 'koffi')
  const koffi = dirname(koffiEntry)
  const binary = dirname(requireFrom(koffiEntry, '@koromix/koffi-win32-x64'))
  for (const [from, to] of [[koffi, 'dist/node_modules/koffi'], [binary, 'dist/node_modules/@koromix/koffi-win32-x64']]) {
    cpSync(from, to, { recursive: true, dereference: true, filter: (path) => !/[\\/]koffi[\\/](doc|vendor|lib)$/.test(path) })
  }
  // The installer packs dist/ as the app: its own package.json names it (the workspace's lists build tools).
  // It names koffi so that electron-builder finds the files above as the app's dependencies and does not pack the workspace's.
  const own_ = JSON.parse(readFileSync('package.json', 'utf8'))
  const koffiVersion = JSON.parse(readFileSync(join(koffi, 'package.json'), 'utf8')).version
  writeFileSync('dist/package.json', JSON.stringify({ name: 'mr-robot-host', productName: 'Mr. Robot host', version: own_.version, description: own_.description, author: 'Mr. Robot', main: 'main.cjs', dependencies: { koffi: koffiVersion } }, null, 2))
}

// Linux: the Landlock launcher DSH falls back to when bubblewrap is not usable. It is a small static program that the bundle cannot
// contain, so it is copied beside the bundle (the app points DSH at it when it starts).
const requireFrom = (from, name) => createRequire(from).resolve(name)
try {
  if (windows) throw new Error('no Landlock on Windows')
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
