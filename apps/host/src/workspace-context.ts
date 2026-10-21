/**
 * The Workspace's context on this computer (v1.21 ticket 04, cw-ec6f, cw-o2qo, cw-hm3d, cw-jc3f, cw-s2rt, cw-rkud): the instruction chain
 * DSH reads and the skills DSH finds, for a Robot's current directory, without a DSH Agent.
 *
 * The chain is DSH's own loader (agent-instructions: discovery from the repository root down to the current directory, the user-global
 * files, the .local.md overlays, duplicates collapsed, the broad-to-specific budget) over a file system of this app's that confines it: a
 * candidate is read only when its real path lies in the repository (or it is one of the two global files of the OS user), so a link in
 * a cloned repository cannot bring a file from elsewhere into a Robot's context. DSH's plugin refreshes the chain from its own tools'
 * touches; here the touches are the Robot's Read and Write calls, which the Workspace session records, and the current directory is the
 * Worker's. The instruction files of a touched directory below the current one are the nested files, as DSH adds them.
 *
 * The skills are DSH's skill-filesystem provider in a skill registry of this app's own (no watcher: the Worker asks at its Turns).
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { loadBaselineInstructions } from '@deepseek-ai/dsh-agent-instructions'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import { INSTRUCTIONS_MAX_BYTES, type HostSkillEntry, type InstructionFileState, type WorkspaceContext } from '@mr-robot/host-protocol'

/** DSH's candidate names, base then overlay, and its per-file cap. */
const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']
const MAX_SOURCE_BYTES = 1024 * 1024

/** Where the harness home and the shared agents root are, as DSH resolves them: the environment, else under the OS user's home. */
export function instructionHomes(home: string, env: NodeJS.ProcessEnv = process.env): { dshHome: string; agentsHome: string } {
  return { dshHome: resolve(env['DSH_HOME'] || join(home, '.dsh')), agentsHome: resolve(env['DSH_AGENTS_HOME'] || join(home, '.agents')) }
}

const inside = (root: string, path: string): boolean => {
  const from = relative(root, path)
  return from === '' || (!from.startsWith(`..${sep}`) && from !== '..' && !isAbsolute(from))
}

const digestOf = (text: string): string => `sha1:${createHash('sha1').update(text).digest('hex')}`

/**
 * The part of DSH's FileSystem service its instruction loader uses (resolve, stat, streamText), confined: a path whose real path is not
 * in the repository is not there, unless it is one of the global files. Not a Service: the loader takes it as a value.
 */
function confinedFileSystem(repository: string, globals: readonly string[]) {
  const missing = (path: string) => Object.assign(new Error(`${path} is outside the repository`), { code: 'FS_NOT_FOUND' })
  return {
    async resolve(path: string) {
      const real = await realpath(path).catch(() => { throw missing(path) })
      if (!globals.includes(resolve(path)) && !inside(repository, real)) throw missing(path)
      return { targetKey: real, displayPath: path }
    },
    async stat(target: { targetKey: string }) {
      const info = await stat(target.targetKey).catch(() => undefined)
      if (info === undefined) return undefined
      return { version: String(info.mtimeMs), type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
    },
    async streamText(target: { targetKey: string }) {
      const text = await readFile(target.targetKey, 'utf8')
      return (async function* () { yield text })()
    },
  }
}

/** One instruction file below the current directory, read when its real path is in the repository. */
async function nestedFile(repository: string, path: string): Promise<{ path: string; content: string } | undefined> {
  const real = await realpath(path).catch(() => undefined)
  if (real === undefined || !inside(repository, real)) return undefined
  const info = await stat(real).catch(() => undefined)
  if (info === undefined || !info.isFile() || info.size > MAX_SOURCE_BYTES) return undefined
  return { path, content: await readFile(real, 'utf8') }
}

/** The directories from just below `from` down to `to`, broad to specific; none when `to` is not below `from`. */
function between(from: string, to: string): string[] {
  if (!inside(from, to) || from === to) return []
  const chain: string[] = []
  for (let current = to; current !== from; current = dirname(current)) chain.push(current)
  return chain.reverse()
}

/** The chain for a current directory: DSH's rendered baseline and the files it kept, then the nested files of touched directories. */
export async function instructionChain(input: {
  readonly home: string
  readonly repository: string
  readonly cwd: string
  readonly touched: readonly string[]
  readonly maxBytes?: number
}): Promise<{ rendered: string; files: Array<{ path: string; content: string }>; nested: number }> {
  const repository = await realpath(input.repository)
  const cwd = resolve(input.cwd)
  const { dshHome, agentsHome } = instructionHomes(input.home)
  const globals = [join(dshHome, 'AGENTS.md'), join(agentsHome, 'AGENTS.md')]
  const fileSystem = confinedFileSystem(repository, globals)
  // SAFETY: the loader calls only resolve, stat and streamText on its file system; this value has those three with DSH's contract.
  const rendered = await loadBaselineInstructions({ cwd, dshHome, agentsHome, projectRoot: repository, maxBytes: input.maxBytes ?? INSTRUCTIONS_MAX_BYTES, maxSourceBytes: MAX_SOURCE_BYTES }, fileSystem as never)
  // The files the baseline was made from, for their digests: a change in any of them renders it again.
  const baseline: Array<{ path: string; content: string }> = []
  for (const path of globals) {
    const content = await readFile(path, 'utf8').catch(() => undefined)
    if (content !== undefined) baseline.push({ path, content })
  }
  for (const directory of chainOf(repository, cwd)) {
    for (const name of CANDIDATES) {
      const file = await nestedFile(repository, join(directory, name))
      if (file !== undefined) baseline.push(file)
    }
  }
  const seen = new Set(baseline.map((file) => file.path))
  const nested: Array<{ path: string; content: string }> = []
  const deeper = [...new Set(input.touched.flatMap((directory) => between(cwd, resolve(directory))))].sort()
  for (const directory of deeper) {
    for (const name of CANDIDATES) {
      const path = join(directory, name)
      if (seen.has(path)) continue
      const file = await nestedFile(repository, path)
      if (file === undefined) continue
      // Within one directory a file whose content repeats an earlier one renders once, as DSH collapses a CLAUDE.md that copies AGENTS.md.
      if (nested.some((kept) => dirname(kept.path) === directory && kept.content.trim() === file.content.trim())) continue
      seen.add(path)
      nested.push(file)
    }
  }
  return { rendered: rendered?.text ?? '', files: [...baseline, ...nested], nested: nested.length }
}

/** The directories from the repository root down to the current directory (the current directory itself when it is not in the repository). */
function chainOf(repository: string, cwd: string): string[] {
  return inside(repository, cwd) ? [repository, ...between(repository, cwd)] : []
}

/** The Host's skills for a current directory: DSH's skill-filesystem in a registry of its own, without a watcher. */
export class HostSkills {
  private constructor(private readonly ctx: Context) {}

  static async start(home: string): Promise<HostSkills> {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry, {})
    await ctx.plugin(SkillFilesystem, { watch: false, ...instructionHomes(home) })
    return new HostSkills(ctx)
  }

  /** The catalog for a directory: each skill with the scope it comes from (cw-s2rt). */
  async list(cwd: string): Promise<HostSkillEntry[]> {
    const skills = await this.ctx.skills.list({ cwd })
    return skills.filter((skill) => skill.invocation?.modelInvocable !== false).map((skill): HostSkillEntry => ({
      name: skill.name,
      description: skill.description,
      scope: String(skill.source).startsWith('project-') ? 'repository' : 'home',
    })).sort((a, b) => (a.name < b.name ? -1 : 1))
  }

  async load(cwd: string, name: string): Promise<{ name: string; content: string; path: string | null } | undefined> {
    const skill = await this.ctx.skills.get(name, { cwd })
    return skill === undefined ? undefined : { name: skill.name, content: skill.content, path: skill.path ?? null }
  }

  async dispose(): Promise<void> {
    await this.ctx.fiber.dispose()
  }
}

/**
 * The Workspace's context for the Worker (WorkspaceOpen and WorkspaceState): the chain with the content of the files the Worker does not
 * hold, and the skills unless the Worker holds the same catalog.
 */
export async function workspaceContext(input: {
  readonly home: string
  readonly repository: string
  readonly cwd: string
  readonly touched: readonly string[]
  readonly known: Readonly<Record<string, string>> | null
  readonly skillsDigest: string | null
  readonly skills: HostSkills
}): Promise<WorkspaceContext> {
  const chain = await instructionChain(input)
  const files: InstructionFileState[] = chain.files.map((file) => {
    const digest = digestOf(file.content)
    return { path: file.path, digest, content: input.known?.[file.path] === digest ? null : file.content }
  })
  const digest = digestOf(JSON.stringify([chain.rendered, files.map((file) => [file.path, file.digest])]))
  const entries = await input.skills.list(input.cwd)
  const skillsDigest = digestOf(JSON.stringify(entries))
  return {
    digest,
    rendered: input.known === null ? chain.rendered : null,
    files,
    nested: chain.nested,
    skills: { digest: skillsDigest, entries: skillsDigest === input.skillsDigest ? null : entries },
  }
}
