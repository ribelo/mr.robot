import { useState } from 'react'
import type { PageView, RobotSummary, SharedPageView } from '@mr-robot/protocol'
import { keys, pageShareAtom, sharedPagesAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { href } from '../route.ts'
import { AtomView } from './AtomView.tsx'

/** The Share switch of a Page's reading view (v1.17, dp-hf7v): the owner's act alone. */
export function PageShare({ robotId, page }: { robotId: string; page: PageView }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const run = async (share: boolean) => {
    const exit = await command((api) => (share ? api.sharePage(robotId, page.path) : api.stopSharing(robotId, page.path)), [keys.sharedPages])
    setError(exitFailure(exit))
  }
  return (
    <AtomView atom={pageShareAtom(robotId + '\n' + page.path)} what="the share link" errorTitle="The share link cannot be read">
      {({ shared }) => <ShareSwitch shared={shared} onShare={() => void run(true)} onStop={() => void run(false)} {...(error === undefined ? {} : { error })} />}
    </AtomView>
  )
}

/** Off: a switch that mints the link. On: the link to copy and Stop sharing. */
export function ShareSwitch({ shared, onShare, onStop, error }: { shared: SharedPageView | null; onShare: () => void; onStop: () => void; error?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="page-share">
      <label className="check">
        <input type="checkbox" role="switch" checked={shared !== null} aria-label="Share with a link" onChange={(event) => (event.target.checked ? onShare() : onStop())} />
        <span>Share with a link</span>
      </label>
      {shared === null ? <span className="muted">Only you see this Page.</span> : (
        <>
          <input className="page-share-link" readOnly value={shared.url} aria-label="Share link" onFocus={(event) => event.target.select()} />
          <button type="button" className="button" onClick={() => { void navigator.clipboard?.writeText(shared.url).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" className="button" onClick={onStop}>Stop sharing</button>
          <span className="muted">Anyone with the link sees this Page and its PDF.</span>
        </>
      )}
      {error === undefined ? null : <div className="muted" role="alert">{error}</div>}
    </div>
  )
}

/** Every Page the person shares, on the profile (dp-zq16): its Robot, title, link and Stop sharing. */
export function SharedPages({ robots }: { robots: readonly RobotSummary[] }) {
  const command = useCommand()
  return (
    <>
      <h2>Shared Pages</h2>
      <AtomView atom={sharedPagesAtom} what="your shared Pages" errorTitle="Your shared Pages cannot be listed">
        {(pages) => <SharedPageList pages={pages} robots={robots} onStop={(page) => void command((api) => api.stopSharing(page.robotId, page.path), [keys.sharedPages])} />}
      </AtomView>
    </>
  )
}

export function SharedPageList({ pages, robots, onStop }: { pages: readonly SharedPageView[]; robots: readonly RobotSummary[]; onStop: (page: SharedPageView) => void }) {
  if (pages.length === 0) return <div className="muted">You share no Pages.</div>
  return (
    <ul className="shared-pages">
      {pages.map((page) => (
        <li key={page.url}>
          <a href={href({ page: 'page', id: page.robotId, path: page.path })}>{page.title}</a>
          <span className="muted"> · {robots.find((robot) => robot.id === page.robotId)?.identity.name ?? 'a Robot'} · since {new Date(page.createdAt).toLocaleDateString()}</span>
          <div className="shared-page-row">
            <input readOnly value={page.url} aria-label={'Link of ' + page.title} onFocus={(event) => event.target.select()} />
            <button type="button" className="button" onClick={() => onStop(page)}>Stop sharing</button>
          </div>
        </li>
      ))}
    </ul>
  )
}
