/**
 * A Robot's memory beyond its context (moved out of robot.ts in v1.20.1 ticket 06): the full-text memory index and its catch-up
 * (v1.20 ticket 03), the owner's people pages as this Robot reaches them (ticket 04), and the dream's inputs and tidy (ticket 05).
 */
import * as Effect from 'effect/Effect'
import type { ModelChoice, TaskView } from '@mr-robot/protocol'
import type { Env } from '../env.ts'
import { PEOPLE_INDEX, PEOPLE_TEMPLATE_PATH } from '../member/people.ts'
import { cutSection, type DreamEvidence } from '../plugins/dream.ts'
import type { Space } from '../space/space.ts'
import type { FileAuthor } from '../workspace/file-history.ts'
import type { WorkspaceShape } from '../workspace/workspace.ts'
import { INDEX_BATCH, isIndexedRobotPath, MemoryIndex, versionOf, type MemoryMatch } from './memory-index.ts'
import type { RobotConfig, RobotStore } from './store.ts'

export interface RobotMemoryHost {
  readonly env: Env
  store(): RobotStore
  sql(): SqlStorage
  workspace(): WorkspaceShape
  space(): DurableObjectStub<Space>
  /** Who the Robot's writes are by now (a memory step's author while it runs). */
  writer(): FileAuthor
  ownerName(): string
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

export class RobotMemory {
  private cache: MemoryIndex | undefined

  constructor(private readonly host: RobotMemoryHost) {}

  private config(): RobotConfig {
    return this.host.store().requireConfig()
  }

  private member() {
    return this.host.env.MEMBER.getByName(this.config().ownerId)
  }

  /** The full-text index of the Robot's memory (memory-index.ts). Reset everything and Start over drop every table: it is made again. */
  get index(): MemoryIndex {
    if (this.cache === undefined || this.host.sql().exec("SELECT 1 FROM sqlite_master WHERE name = 'memory_indexed'").toArray().length === 0) this.cache = new MemoryIndex(this.host.sql())
    return this.cache
  }

  /** Every Workspace write reindexes an indexed file at once (dm-yn3q): the Robot's, the owner's, a memory step's, a restore. */
  written(path: string, text: string | undefined, etag: string | undefined): void {
    if (!isIndexedRobotPath(path)) return
    if (etag === undefined) return this.index.remove('robot', path)
    // A stream's text is not at hand: the next catch-up reads it.
    if (text === undefined) return this.index.index('robot', path, '', 'stale')
    this.index.index('robot', path, text, etag)
  }

  /**
   * Bring the index up to date, at most INDEX_BATCH files (dm-yn3q): the Robot's indexed files whose etag changed or that are new, the ones
   * gone, and the Member and Space files it reads by their content. Run at each Turn's start and before a search.
   */
  async catchUp(limit = INDEX_BATCH): Promise<void> {
    const index = this.index
    const ws = this.host.workspace()
    let budget = limit
    const [memory, dreams, roots] = await Promise.all([
      run(ws.list('memory')),
      run(ws.list('dreams')),
      Promise.all(['MEMORY.md', 'AGENTS.md', 'SOUL.md'].map((path) => run(ws.stat(path)))),
    ])
    const present = [...memory, ...dreams, ...roots.flatMap((entry) => (entry === undefined ? [] : [entry]))].filter((entry) => isIndexedRobotPath(entry.path))
    const known = new Map(index.indexed('robot').map((row) => [row.path, row.version]))
    for (const entry of present) {
      if (budget <= 0) break
      if (known.get(entry.path) === entry.etag) continue
      const text = await run(ws.readText(entry.path))
      index.index('robot', entry.path, text ?? '', entry.etag)
      budget -= 1
    }
    const paths = new Set(present.map((entry) => entry.path))
    for (const path of known.keys()) if (!paths.has(path)) index.remove('robot', path)
    const [member, space] = await Promise.all([
      Promise.all([this.member().files(), this.member().peoplePages()]).then(([files, people]) => ({ ...files, ...people }) as Record<string, string>).catch(() => undefined),
      this.host.space().spaceMemory().catch(() => undefined),
    ])
    const shared: Array<['member' | 'space', Record<string, string> | undefined]> = [['member', member], ['space', space === undefined ? undefined : { 'SPACE.md': space }]]
    for (const [scope, files] of shared) {
      if (files === undefined) continue
      for (const [path, text] of Object.entries(files)) {
        const version = versionOf(text)
        if (index.version(scope, path) !== version) index.index(scope, path, text, version)
      }
      for (const row of index.indexed(scope)) if (!(row.path in files)) index.remove(scope, row.path)
    }
  }

  /** memory_search (dm-hmet): the index caught up first, then the ranked matches. */
  async search(query: string, limit?: number): Promise<MemoryMatch[]> {
    await this.catchUp()
    return this.index.search(query, limit)
  }

  // ---------------------------------------------------------------- people pages (v1.20 ticket 04)

  peopleFile(path: string): Promise<string | undefined> {
    return this.member().peopleFile(path)
  }

  async peoplePaths(): Promise<string[]> {
    const pages = await this.member().peoplePages().catch(() => ({}))
    return [...new Set([PEOPLE_TEMPLATE_PATH, PEOPLE_INDEX, ...Object.keys(pages)])].sort()
  }

  /** Only Mr. Robot deletes a people page: merging two pages of one person (dm-kkgy). */
  async removePeoplePage(path: string): Promise<void> {
    if (this.config().kind !== 'mr-robot') throw new Error(`${path} is your owner's people page: correct it with write; only your owner deletes it, or Mr. Robot when he merges two pages of one person.`)
    await this.member().removePeoplePage(path)
    this.index.remove('member', path)
  }

  async writePeoplePage(path: string, content: string): Promise<void> {
    const writer = this.host.writer()
    // A memory step writes as itself; otherwise the page names this Robot.
    const author: FileAuthor = writer.kind === 'robot' ? { kind: 'robot', name: this.config().identity.name } : writer
    await this.member().writePeoplePage(path, content, author)
    this.index.index('member', path, content, versionOf(content))
  }

  // ---------------------------------------------------------------- the dream (v1.20 ticket 05)

  /** The dream's route: the Robot's dreamModel, else the Space's, else undefined (the Robot's own model). */
  async dreamRoute(): Promise<ModelChoice | undefined> {
    const own = this.config().dreamModel
    if (own != null) return own
    return (await this.host.space().settings().catch(() => undefined))?.defaultDreamModel ?? undefined
  }

  /** What the day left (dm-pzxk): daily notes changed, chapters closed, Attempts failed or skipped, Asks answered, since `since`. */
  async dreamEvidence(since: number): Promise<DreamEvidence> {
    const config = this.config()
    const store = this.host.store()
    const own = (await run(this.host.workspace().list('memory'))).filter((entry) => /^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(entry.path) && entry.uploaded > since).map((entry) => entry.path).sort()
    // Mr. Robot's dream also reads his owner's Robots' daily notes, through his deputy reads (dm-pt5b).
    const theirs = config.kind !== 'mr-robot' ? [] : (await Promise.all((await this.host.space().reachable(config.ownerId).catch(() => [])).filter((robot) => robot.ownerId === config.ownerId && robot.id !== config.id && robot.kind === 'robot').map(async (robot) => {
      const files = await this.host.env.ROBOT.getByName(robot.id).files().catch(() => [])
      return files.filter((file) => file.group === 'daily' && file.updatedAt > since).map((file) => `${robot.identity.name} (${robot.id}): ${file.path}`)
    }))).flat()
    const chapters = store.chapters.all().flatMap((chapter) => (chapter.state.kind === 'closed' && chapter.state.at > since ? [{ ordinal: chapter.ordinal, closedBy: chapter.state.by }] : []))
    const caller = { kind: 'robot' as const, robotId: config.id, ownerId: config.ownerId, actor: { kind: 'robot' as const, robotId: config.id, name: config.identity.name, avatarColor: config.identity.avatarColor, avatarSeed: config.identity.avatarSeed } }
    const tasks = await this.host.space().listTasks(caller, { state: 'all', assignee: { kind: 'robot', robotId: config.id } }).catch(() => ({ tasks: [] as TaskView[] }))
    const closedAttempts = tasks.tasks.flatMap((task) => task.attempts.filter((attempt) => attempt.robotId === config.id && (attempt.finishedAt ?? 0) > since)).length
    const attempts = tasks.tasks.flatMap((task) => task.attempts.filter((attempt) => attempt.robotId === config.id && (attempt.finishedAt ?? 0) > since && (attempt.outcome === 'failed' || attempt.outcome === 'skipped')).map((attempt) => ({ taskId: task.id, title: task.title, outcome: attempt.outcome, line: attempt.firstLine })))
    const answered = store.proposals().filter((proposal) => (proposal.answeredAt ?? 0) > since)
    // A dismissed question is stored as rejected (store.ts): both are listed.
    const asks = answered.filter((proposal) => String(proposal.status) === 'rejected').map((proposal) => ({ id: proposal.id, status: 'dismissed or rejected', purpose: proposal.purpose }))
    return { notes: [...own, ...theirs], chapters, attempts, asks, answered: answered.length, closedAttempts }
  }

  /** After the dream: the AGENTS.md section is cut to its limit (dm-4ybd). */
  async afterDream(): Promise<void> {
    const ws = this.host.workspace()
    const agents = await run(ws.readText('AGENTS.md'))
    const cut = agents === undefined ? undefined : cutSection(agents, this.host.ownerName())
    if (cut !== undefined) await run(ws.write('AGENTS.md', cut, 'text/markdown; charset=utf-8', { kind: 'platform' }))
  }
}