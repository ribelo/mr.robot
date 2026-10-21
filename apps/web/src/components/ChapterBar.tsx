/**
 * The chapters of a Conversation above its Trajectory (v1.19, ec-mwvo): Previous and Next, and a picker that names each chapter by its
 * dates, its Turns and why it closed. A superseded chapter (a Rewind went back before it) is listed greyed and read-only (ec-cc6i).
 */
import type { ChapterView } from '@mr-robot/protocol'

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** One chapter in words: "Chapter 12 · 3 Oct 2026 – 5 Oct 2026 · 19 Turns · compaction". */
export function chapterLabel(chapter: ChapterView): string {
  const until = chapter.closedAt === null ? 'now' : day(chapter.closedAt)
  const why = chapter.closedBy === null ? 'live' : chapter.closedBy === 'compaction' ? 'closed by compaction' : 'closed by a Rewind'
  return `Chapter ${chapter.ordinal} · ${day(chapter.openedAt)} – ${until} · ${chapter.turns} ${chapter.turns === 1 ? 'Turn' : 'Turns'} · ${why}${chapter.superseded ? ' · superseded' : ''}`
}

export function ChapterBar({ chapters, shown, onShow }: { chapters: readonly ChapterView[]; shown: number; onShow: (ordinal: number) => void }) {
  const at = chapters.findIndex((chapter) => chapter.ordinal === shown)
  const previous = at > 0 ? chapters[at - 1] : undefined
  const next = at >= 0 && at < chapters.length - 1 ? chapters[at + 1] : undefined
  const current = chapters[at]
  return (
    <div className={current?.superseded === true ? 'chapter-bar superseded' : 'chapter-bar'}>
      <button type="button" className="button" disabled={previous === undefined} onClick={() => previous !== undefined && onShow(previous.ordinal)}>‹ Previous</button>
      <select aria-label="Chapter" value={shown} onChange={(event) => onShow(Number(event.target.value))}>
        {chapters.map((chapter) => (
          <option key={chapter.ordinal} value={chapter.ordinal} className={chapter.superseded ? 'superseded' : undefined}>{chapterLabel(chapter)}</option>
        ))}
      </select>
      <button type="button" className="button" disabled={next === undefined} onClick={() => next !== undefined && onShow(next.ordinal)}>Next ›</button>
      {current?.superseded === true ? <span className="muted">A Rewind went back before this chapter: it is kept to read, and the Robot does not see it.</span> : null}
    </div>
  )
}
