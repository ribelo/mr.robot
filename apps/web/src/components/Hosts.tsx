import { Empty, ErrorState } from './States.tsx'
import { hostBridge } from './ThisComputer.tsx'
import { go } from '../route.ts'
import { useEffect, useState } from 'react'
import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import { AsyncResult } from 'effect/reactivity'
import { hostsAtom, keys, pairingAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { renderResult } from './AtomView.tsx'

const ago = (at: number | null) => (at === null ? 'never' : new Date(at).toLocaleString())

/** The Member's computers (hs-ro43, hs-0eka, hs-rwxw): online state, sharing, unpair. */
export function Hosts() {
  const result = useAtomValue(hostsAtom)
  const hosts = AsyncResult.isSuccess(result) ? result.value : undefined
  const refresh = useAtomRefresh(hostsAtom)
  const command = useCommand()
  // Online state changes without a click; the list reads again every 10 seconds.
  useEffect(() => {
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])
  return (
    <>
      <h2>Hosts</h2>
      {hostBridge() === undefined ? null : <div><button type="button" className="button" onClick={() => go({ page: 'this-computer' })}>This computer…</button></div>}
      <div className="muted">Computers running the Mr. Robot desktop app. Install it, enter this server's address, sign in there and pair from its This computer page.</div>
      {hosts === undefined ? null : hosts.length === 0 ? <div className="muted">No computers paired yet.</div> : (
        <table className="grid"><tbody>{hosts.map((host) => (
          <tr key={host.id}>
            <td><b>{host.name}</b><div className="muted">{host.platform}{host.version === null ? '' : ` · app ${host.version}`}{host.capabilities === null ? '' : ` · ${host.capabilities.chrome === null ? 'no Chrome' : 'Chrome'}${host.capabilities.graphical ? '' : ', no display'}`}</div></td>
            <td>{host.online ? <span>● online</span> : <span className="muted">offline · last seen {ago(host.lastSeen)}</span>}{host.users.length > 0 ? <div className="muted">used by {host.users.join(', ')}</div> : null}</td>
            <td>{host.mine ? (
              <select value={host.sharing} onChange={(event) => { const sharing = event.target.value === 'home' ? 'home' : 'private'; void command((api) => api.setHostSharing(host.id, sharing), [keys.hosts]) }}>
                <option value="private">Only my robots</option>
                <option value="home">Shared with the Home</option>
              </select>
            ) : <span className="muted">{host.ownerName}'s, shared</span>}</td>
            <td>{host.mine ? <button type="button" className="link" onClick={() => { if (confirm(`Unpair ${host.name}? Its app disconnects and must be paired again.`)) void command((api) => api.unpairHost(host.id), [keys.hosts]) }}>Unpair</button> : null}</td>
          </tr>
        ))}</tbody></table>
      )}
    </>
  )
}

/** The page the app opens to pair a computer (hs-hend): signed in through Access, one tap. */
export function PairHost({ code }: { code: string }) {
  const result = useAtomValue(pairingAtom(code))
  const command = useCommand()
  const [outcome, setOutcome] = useState<{ readonly paired: string } | { readonly failed: string }>()
  if (outcome !== undefined) return 'paired' in outcome ? <div className="form"><Empty title="Paired" hint={outcome.paired} /></div> : <div className="form"><ErrorState title="This computer cannot be paired" message={outcome.failed} /></div>
  return <>{renderResult(result, { what: 'the pairing', errorTitle: 'This computer cannot be paired' }, (pending) => (
    <div className="form">
      <p>Pair the computer <b>{pending.name}</b> ({pending.platform}) with your Mr. Robot? Robots you grant it can then use its files, a shell as you, and its Chrome while the app runs.</p>
      <p className="muted">Code {code}: check it matches the one in the app.</p>
      {pending.approved ? <p>Already paired.</p> : (
        <div className="question-actions">
          <button type="button" className="button button-primary" onClick={() => void command((api) => api.approvePairing(code), [keys.hosts]).then((exit) => setOutcome(Exit.isSuccess(exit) ? { paired: `Paired ${exit.value.name}. You can close this tab; the app connects by itself.` } : { failed: exitFailure(exit) ?? 'could not pair' }))}>Pair this computer</button>
        </div>
      )}
    </div>
  ))}</>
}
