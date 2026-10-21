/**
 * Dreaming (v1.20 ticket 05, dm-hx44 to dm-buya): once a night at 03:00 in the owner's time zone, a Robot with dreaming on looks back
 * at its day. The contract is in docs/dreaming.md (the product doc) and here:
 *
 * - Trigger: the dream duty at the dream hour, after the dream-hour close; skipped when no daily note changed, no Attempt closed and no
 *   Ask was answered since the last dream.
 * - Model: the Robot's dreamModel, else the Space's defaultDreamModel, else the Robot's own model.
 * - The dream is a Turn with the cause dream, in the chapter the dream-hour close opened, at most DREAM_STEPS model steps.
 * - Tools: the file tools on the Workspace, memory_search, conversation_search, task_list, propose_skill, propose_member_file_edit and
 *   ask (one call, with dismiss_on_move_on). No tool that touches the world, and no say.
 * - Instruction: dreamNote, fixed, with the inputs the plugin supplies (chapters closed, Attempts failed or skipped, Asks dismissed or
 *   rejected, the daily notes changed, with ids).
 * - Outputs: dreams/YYYY-MM-DD.md; the AGENTS.md section "How to act for <owner>", at most DREAM_SECTION_LINES lines (the platform cuts
 *   a longer one); proposals; at most one question for the morning.
 * - Record: usage under the source memory; the Trajectory shows the dream like any Turn.
 */
import type { Duty } from '../robot/duties.ts'
import type { RobotStore } from '../robot/store.ts'

export const DREAM_STEPS = 12
export const DREAM_SECTION_LINES = 30
/** The kv keys of the next dream hour and of when the last dream started. */
export const DREAM_AT = 'dream-at'
export const DREAMED_AT = 'dreamed-at'

export const DREAM_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'glob', 'grep', 'memory_search', 'conversation_search', 'task_list', 'propose_skill', 'propose_member_file_edit', 'ask'])
/** Mr. Robot's dream (dm-pt5b, dm-w15l, dm-kkgy): also his deputy reads of his owner's Robots, never their writes, and delete_file to merge two people pages. */
export const CHIEF_DREAM_TOOLS: ReadonlySet<string> = new Set([...DREAM_TOOLS, 'robot_files', 'robot_file_read', 'delete_file'])

/** What the day left behind for the dream to read. */
export interface DreamEvidence {
  readonly notes: readonly string[]
  readonly chapters: ReadonlyArray<{ readonly ordinal: number; readonly closedBy: string }>
  readonly attempts: ReadonlyArray<{ readonly taskId: string; readonly title: string; readonly outcome: string; readonly line: string }>
  readonly asks: ReadonlyArray<{ readonly id: string; readonly status: string; readonly purpose: string }>
  /** Asks answered at all since the last dream: the skip rule counts them, the note lists only the dismissed or rejected. */
  readonly answered: number
  /** Attempts of this Robot closed since the last dream, whatever their outcome: the spec's skip rule counts every one (v1.20.1). */
  readonly closedAttempts: number
}

export const isEmptyEvidence = (evidence: DreamEvidence): boolean => evidence.notes.length === 0 && evidence.attempts.length === 0 && evidence.closedAttempts === 0 && evidence.answered === 0

/** The dream's instruction (fixed) with its inputs. */
export function dreamNote(owner: string, date: string, evidence: DreamEvidence, chief: boolean): string {
  const list = <T,>(items: readonly T[], line: (item: T) => string) => (items.length === 0 ? ['- none'] : items.map(line))
  return [
    `Dream: it is night; nobody is watching. Look back at the day and leave yourself better for tomorrow. Do not greet, and do not use say.`,
    '',
    'Read first: your daily notes below, MEMORY.md, AGENTS.md, and with memory_search and conversation_search what you need of the day.',
    'Daily notes changed since the last dream:', ...list(evidence.notes, (path) => `- ${path}`),
    'Chapters closed since the last dream:', ...list(evidence.chapters, (chapter) => `- chapter ${chapter.ordinal} (${chapter.closedBy})`),
    'Attempts that failed or were skipped:', ...list(evidence.attempts, (attempt) => `- ${attempt.taskId} "${attempt.title}": ${attempt.outcome}, ${attempt.line}`),
    'Asks dismissed or rejected:', ...list(evidence.asks, (ask) => `- ${ask.id} (${ask.status}): ${ask.purpose}`),
    '',
    'Then write three things:',
    `1. dreams/${date}.md: what worked, what went wrong and why, what you will do differently. Plain and short.`,
    `2. In AGENTS.md, the section "## How to act for ${owner}": rewrite it from what you learned, at most ${DREAM_SECTION_LINES} lines.`,
    '3. When the evidence calls for it: propose_skill for work that recurs, or propose_member_file_edit for what your owner\'s files should say.',
    'Rules: write only your own files; propose the rest. At most one question for the morning, with ask and dismiss_on_move_on true, and only if PROACTIVE_PREFERENCES.md allows it. Then end.',
    ...(chief ? ['', 'You are the chief: the notes above include your owner\'s Robots\'; read them with robot_file_read. Propose with propose_member_file_edit what they show about your owner. Tend memory/people/: when two pages are one person, write the merged page and delete the other with delete_file. Write only your own files and the people pages. No memory moves between Robots: never copy a Robot\'s knowledge of its job into another.'] : []),
  ].join('\n')
}

/** One question for the morning, carrying dismiss_on_move_on (dm-s11z). */
export function dreamArgsCheck(): (tool: string, args: Readonly<Record<string, unknown>>) => string | undefined {
  let asked = false
  return (tool, args) => {
    if (tool === 'ask') {
      if (asked) return 'a dream asks at most one question'
      if (args['dismiss_on_move_on'] !== true) return 'the morning question carries dismiss_on_move_on: true'
      asked = true
      return undefined
    }
    return args['on'] === undefined || args['on'] === 'workspace' ? undefined : 'a dream works only on the Workspace (on: "workspace")'
  }
}

/** The AGENTS.md section, cut to its line limit (dm-4ybd); undefined when it is within it or absent. */
export function cutSection(agents: string, owner: string): string | undefined {
  const lines = agents.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## How to act for ${owner}`)
  if (start === -1) return undefined
  let end = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line))
  if (end === -1) end = lines.length
  const body = lines.slice(start + 1, end)
  while (body.length > 0 && body.at(-1)!.trim() === '') body.pop()
  if (body.length <= DREAM_SECTION_LINES) return undefined
  return [...lines.slice(0, start + 1), ...body.slice(0, DREAM_SECTION_LINES), '', ...lines.slice(end)].join('\n')
}

export interface DreamHost {
  readonly store: RobotStore
  nextDreamHour(after: number): number
  /** The Robot's own setting, else the Space's. */
  dreamingOn(): Promise<boolean>
  idleNow(): boolean
  evidence(since: number): Promise<DreamEvidence>
  /** Queue the dream's Wake-up. */
  dream(evidence: DreamEvidence, now: number): void
}

/** The dream duty (order 96: after the dream-hour close at the same hour). */
export function dreamDuty(host: DreamHost): Duty {
  return {
    name: 'dream',
    order: 96,
    scope: 'active',
    nextAt: (now) => (host.store.config()?.dreaming === false ? undefined : host.store.get<number>(DREAM_AT) ?? host.nextDreamHour(now)),
    run: async (now) => {
      const due = host.store.get<number>(DREAM_AT)
      if (due === undefined) return host.store.set(DREAM_AT, host.nextDreamHour(now))
      if (due > now || !host.idleNow()) return
      host.store.set(DREAM_AT, host.nextDreamHour(now))
      if (!(await host.dreamingOn())) return
      const since = host.store.get<number>(DREAMED_AT) ?? 0
      const evidence = await host.evidence(since)
      if (isEmptyEvidence(evidence)) return
      // DREAMED_AT moves when the dream did its work (robot.ts, at the dream's end), never before it ran (v1.20.1).
      host.dream(evidence, now)
    },
  }
}