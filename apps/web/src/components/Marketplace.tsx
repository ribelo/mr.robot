/**
 * The Marketplace (v1.18, rm-vhrq, rm-mv69, rm-10ai): the Robot definitions of the Space's library, each with its title, paragraph,
 * what it needs (marked when the Member already has it), who made it and when; Add makes a Robot of his in setup. The admin publishes,
 * takes back and removes, and anyone who sees one downloads its directory to commit to the library repository.
 */
import { useState } from 'react'
import * as Exit from 'effect/Exit'
import type { MarketplaceEntry } from '@mr-robot/protocol'
import { keys, marketplaceAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { go } from '../route.ts'
import { AtomView } from './AtomView.tsx'
import { Empty } from './States.tsx'

export function Marketplace({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
    <GrokImport />
    <AtomView atom={marketplaceAtom} what="the Marketplace" errorTitle="The Marketplace cannot be opened">
      {(entries) => entries.length === 0
        ? <Empty title="No definitions yet" hint="Save a Robot as a definition from its settings, or commit one under robots/ in the library repository and sync it." />
        : <ul className="marketplace">{entries.map((entry) => <DefinitionCard key={entry.definition.slug} entry={entry} isAdmin={isAdmin} />)}</ul>}
    </AtomView>
    </>
  )
}

/** Add from a Grok Bot marketplace address (rm-pdgk): a brief, yours until the admin publishes it. */
function GrokImport() {
  const command = useCommand()
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<string>()
  const importIt = async () => {
    const exit = await command((api) => api.importGrok(url), [keys.marketplace])
    setStatus(Exit.isSuccess(exit) ? `Imported "${exit.value.title}" as a brief: an imported summary, since Grok Bot keeps the recipe closed.` : exitFailure(exit))
    if (Exit.isSuccess(exit)) setUrl('')
  }
  return (
    <div className="form">
      <label>Add from a Grok Bot address <input value={url} placeholder="https://x.ai/bot/marketplace/bots/…" onChange={(event) => setUrl(event.target.value)} /></label>
      <div><button type="button" className="button" disabled={url.trim() === ''} onClick={() => void importIt()}>Import</button></div>
      {status === undefined ? null : <div className="muted">{status}</div>}
    </div>
  )
}

function DefinitionCard({ entry, isAdmin }: { entry: MarketplaceEntry; isAdmin: boolean }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const { definition } = entry
  const add = async () => {
    const exit = await command((api) => api.addDefinition(definition.slug), [keys.robots])
    if (Exit.isSuccess(exit)) go({ page: 'robot', id: exit.value.id, panel: false })
    else setError(exitFailure(exit))
  }
  const act = async (run: Parameters<typeof command>[0]) => setError(exitFailure(await command(run, [keys.marketplace])))
  return (
    <li className="task-card definition-card">
      <span className="task-card-text">
        <span className="task-name">{definition.title}</span>
        <span>{definition.paragraph}</span>
        <span className="muted">{definition.author} · {new Date(definition.updatedAt).toLocaleDateString()}{definition.source === 'import' ? ' · imported summary' : ''}{definition.published ? '' : ' · not published'}</span>
        {entry.needs.length === 0 && entry.tools.length === 0 ? null : (
          <span className="definition-needs" aria-label={`Needs of ${definition.title}`}>
            {entry.tools.map((tool) => <span key={`tool-${tool}`} className="pill">{tool}</span>)}
            {entry.needs.map((need) => <span key={`${need.kind}-${need.label}`} className={need.met ? 'pill' : 'pill pill-warn'} title={need.met ? 'You have this' : 'Add will ask for this'}>{need.met ? '✓ ' : ''}{need.label}</span>)}
          </span>
        )}
        {error === undefined ? null : <span className="muted">{error}</span>}
      </span>
      <span className="definition-actions">
        <button type="button" className="button" onClick={() => void add()}>Add</button>
        <a className="link" href={`/api/definitions/${encodeURIComponent(definition.slug)}/archive`} download={`${definition.slug}.tar.gz`}>Download definition</a>
        {isAdmin ? <button type="button" className="link" onClick={() => void act((api) => api.publishDefinition(definition.slug, !definition.published))}>{definition.published ? 'Unpublish' : 'Publish'}</button> : null}
        {isAdmin ? <button type="button" className="link" onClick={() => { if (confirm(`Remove ${definition.title} from the library?`)) void act((api) => api.removeDefinition(definition.slug)) }}>Remove</button> : null}
      </span>
    </li>
  )
}
