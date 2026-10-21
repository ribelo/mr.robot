/**
 * The Marketplace (v1.18, rm-vhrq, rm-mv69, rm-10ai): the Robot definitions of the Space's library, each with its title, paragraph,
 * what it needs (marked when the Member already has it), who made it and when; Add makes a Robot of his in setup. The admin publishes,
 * takes back and removes, and anyone who sees one downloads its directory to commit to the library repository.
 */
import { useState } from 'react'
import * as Exit from 'effect/Exit'
import type { MarketplaceEntry } from '@mr-robot/protocol'
import { useAtomValue } from '@effect/atom-react'
import { AsyncResult } from 'effect/reactivity'
import { hostsAtom, keys, marketplaceAtom, useCommand } from '../client/api-atoms.ts'
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

/** The Add form's Workspace (cw-nm6y): one of the Member's computers and a folder there, checked when the Robot's setup is approved. */
function AddWorkspace({ title, onAdd, onCancel }: { title: string; onAdd: (workspace?: { host: string; root: string }) => void; onCancel: () => void }) {
  const hosts = AsyncResult.getOrElse(useAtomValue(hostsAtom), () => [])
  const [host, setHost] = useState('')
  const [root, setRoot] = useState('')
  const chosen = host === '' ? hosts[0]?.id ?? '' : host
  return (
    <span className="form" role="group" aria-label={`Workspace for ${title}`}>
      <span>Where will it work? A folder on one of your computers, inside a git repository. It is checked when you approve its setup.</span>
      {hosts.length === 0 ? <span className="muted">You have no computer paired yet: add it without a Workspace and choose one in its settings later.</span> : (
        <>
          <label>Computer
            <select aria-label="Computer" value={chosen} onChange={(event) => setHost(event.target.value)}>
              {hosts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label>Folder <input aria-label="Folder" placeholder="~/projects/my-repo" value={root} onChange={(event) => setRoot(event.target.value)} /></label>
        </>
      )}
      <span className="question-actions">
        <button type="button" className="button" disabled={hosts.length > 0 && root.trim() === ''} onClick={() => onAdd(hosts.length === 0 ? undefined : { host: chosen, root: root.trim() })}>Add with this Workspace</button>
        <button type="button" className="link" onClick={() => onAdd()}>Add without a Workspace</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </span>
    </span>
  )
}

function DefinitionCard({ entry, isAdmin }: { entry: MarketplaceEntry; isAdmin: boolean }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const { definition } = entry
  // A definition that needs a computer asks for the Workspace first (v1.21, cw-nm6y): the Robot in setup knows its repository.
  const needsHost = entry.needs.some((need) => need.kind === 'host')
  const [asking, setAsking] = useState(false)
  const add = async (workspace?: { host: string; root: string }) => {
    const exit = await command((api) => api.addDefinition(definition.slug, workspace), [keys.robots])
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
        {definition.invalid === undefined ? null : <span className="muted">The repository's version is refused, so this is the last good one: {definition.invalid}</span>}
        {error === undefined ? null : <span className="muted">{error}</span>}
        {asking ? <AddWorkspace title={definition.title} onAdd={(workspace) => void add(workspace)} onCancel={() => setAsking(false)} /> : null}
      </span>
      <span className="definition-actions">
        <button type="button" className="button" onClick={() => (needsHost ? setAsking(true) : void add())}>Add</button>
        <a className="link" href={`/api/definitions/${encodeURIComponent(definition.slug)}/archive`} download={`${definition.slug}.tar.gz`}>Download definition</a>
        {isAdmin ? <button type="button" className="link" onClick={() => void act((api) => api.publishDefinition(definition.slug, !definition.published))}>{definition.published ? 'Unpublish' : 'Publish'}</button> : null}
        {isAdmin ? <button type="button" className="link" onClick={() => { if (confirm(`Remove ${definition.title} from the library?`)) void act((api) => api.removeDefinition(definition.slug)) }}>Remove</button> : null}
      </span>
    </li>
  )
}
