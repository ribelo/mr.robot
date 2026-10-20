import type { PageView } from '@mr-robot/protocol'
import { pagesAtom } from '../client/api-atoms.ts'
import { href } from '../route.ts'
import { AtomView } from './AtomView.tsx'

/** The Robot's Pages in its panel, newest first (v1.17, dp-lxw4). */
export function RobotPages({ robotId }: { robotId: string }) {
  return <AtomView atom={pagesAtom(robotId)} what="the Pages" errorTitle="The Pages cannot be listed">{(pages) => <PageList robotId={robotId} pages={pages} />}</AtomView>
}

export function PageList({ robotId, pages }: { robotId: string; pages: readonly PageView[] }) {
  return (
    <section aria-label="Pages">
      <h3 className="panel-section">Pages</h3>
      {pages.length === 0 ? <div className="muted">No Pages yet.</div> : (
        <ul className="page-list">
          {pages.map((page) => (
            <li key={page.path}>
              <a href={href({ page: 'page', id: robotId, path: page.path })}>
                <span className="page-list-title">{page.title}</span>
                <span className="muted"> · {new Date(page.updatedAt).toLocaleDateString()}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A say attachment that is a Page (v1.17, dp-35i9): its title and first lines; it opens the reading view. */
export function PageCard({ robotId, path, title, excerpt }: { robotId: string; path: string; title: string; excerpt: string }) {
  return (
    <a className="page-card" href={href({ page: 'page', id: robotId, path })} aria-label={'Page ' + title}>
      <span className="page-card-kind muted">Page</span>
      <span className="page-card-title">{title}</span>
      {excerpt === '' ? null : <span className="page-card-excerpt muted">{excerpt}</span>}
    </a>
  )
}
