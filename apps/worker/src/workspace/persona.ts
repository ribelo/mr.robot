/**
 * The Robot's persona and memory as the model sees them: the Muse layout read from its
 * Workspace before every Turn (robot-om9f), plus the owner's Member files (robot-mj7v).
 */
export const PERSONA_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md'] as const

export interface PersonaSnapshot {
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>
  /** SOUL.md as it was at the start of the Turn, to notice a change (robot-h1nm). */
  readonly soul: string
}

/** Today's and yesterday's daily notes in the owner's time zone: memory/YYYY-MM-DD.md. */
export function dailyNotePaths(now: number, timeZone: string): string[] {
  const day = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  return [`memory/${day(now - 86_400_000)}.md`, `memory/${day(now)}.md`]
}

export function personaText(snapshot: PersonaSnapshot): string {
  const sections = snapshot.files
    .filter((file) => file.content.trim() !== '')
    .map((file) => `<file path="${file.path}">\n${file.content.trim()}\n</file>`)
  return [
    'Your Workspace files as of the start of this Turn. Your persona, memory and notes are yours to edit with the file tools; USER.md and PROACTIVE_PREFERENCES.md are your owner\'s and read-only.',
    ...sections,
  ].join('\n\n')
}
