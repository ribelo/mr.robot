/**
 * Architecture lint (robot-c8hq, robot-naul):
 * 1. No Node-bound DeepSeek Harness package is bundled into the Worker.
 * 2. No DeepSeek Harness package imports Effect: Effect lives at Mr. Robot's plugin boundary only.
 * It inspects the real Worker bundle (wrangler's esbuild metafile), not just package.json.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Node-bound plugin packages (filesystem, processes, shells, local stores) and the subagent
 * packages (robot-eiin). Utility libraries such as dsh-home-paths or dsh-atomic-write are
 * imported by the DeepSeek adapter's file-upload index but never run in a Robot; they are
 * not plugins and are not listed. dsh-sandbox is the abstract seam dsh-tools imports for
 * its vocabulary; no sandbox provider is mounted.
 */
const NODE_BOUND = [
  'dsh-fs-local', 'dsh-fs-sandbox', 'dsh-subprocess', 'dsh-subprocess-local', 'dsh-shell', 'dsh-terminal',
  'dsh-sandbox-local', 'dsh-session-persistence-jsonl', 'dsh-attachment-local', 'dsh-credentials-local',
  'dsh-skill-filesystem', 'dsh-tool-fs-search', 'dsh-ptc-runtime-node', 'dsh-storage-sqlite', 'dsh-storage-json',
  'dsh-subagent', 'dsh-tool-subagent', 'dsh-subagent-in-process-driver', 'dsh-subagent-spawn-in-process',
  'dsh-tool-bash', 'dsh-bash-local', 'dsh-bash-sandbox',
]

const out = mkdtempSync(join(tmpdir(), 'mr-robot-bundle-'))
const metafile = join(out, 'meta.json')
execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '-c', 'wrangler.dev.jsonc', '--outdir', out, '--metafile', metafile], {
  cwd: 'apps/worker',
  stdio: ['ignore', 'ignore', 'inherit'],
})
const meta = JSON.parse(readFileSync(metafile, 'utf8')) as { inputs: Record<string, unknown> }
const inputs = Object.keys(meta.inputs)
const problems: string[] = []

for (const input of inputs) {
  const match = /@deepseek-ai\/(dsh-[a-z0-9-]+)\//.exec(input)
  if (match !== null && NODE_BOUND.includes(match[1]!)) problems.push(`Node-bound DSH package bundled: ${match[1]} (${input})`)
}

for (const input of inputs.filter((path) => /@deepseek-ai\/dsh-[^/]+\//.test(path))) {
  const source = readFileSync(join('apps/worker', input), 'utf8')
  if (/from\s+["']effect(\/[^"']*)?["']|import\(\s*["']effect/.test(source)) problems.push(`DSH package imports Effect: ${input}`)
}

const dsh = new Set(inputs.flatMap((path) => /@deepseek-ai\/(dsh-[a-z0-9-]+)\//.exec(path)?.[1] ?? []))
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`dependency lint: ${dsh.size} DSH packages bundled, none Node-bound, none importing Effect`)