import { Loading, Empty, ErrorState } from './States.tsx'
import { hostBridge } from './ThisComputer.tsx'
import { go } from '../route.ts'
import { useEffect, useState } from 'react'
import type { HostView } from '@mr-robot/protocol'
import { api, ApiError } from '../api.ts'

const ago = (at: number | null) => (at === null ? 'never' : new Date(at).toLocaleString())

/** The Member's computers (hs-ro43, hs-0eka, hs-rwxw): online state, sharing, unpair. */
export function Hosts() {
  const [hosts, setHosts] = useState<HostView[]>()
  const refresh = () => void api.hosts().then(setHosts)
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <>
      <h2>Hosts</h2>
      {hostBridge() === undefined ? null : <div><button type="button" className="button" onClick={() => go({ page: 'this-computer' })}>This computer…</button></div>}
      <div className="muted">Computers running the Mr. Robot app. Install it, enter this server's address ({location.origin}), and approve the computer when the browser opens.</div>
      {hosts === undefined ? null : hosts.length === 0 ? <div className="muted">No computers paired yet.</div> : (
        <table className="grid"><tbody>{hosts.map((host) => (
          <tr key={host.id}>
            <td><b>{host.name}</b><div className="muted">{host.platform}{host.version === null ? '' : ` · app ${host.version}`}{host.capabilities === null ? '' : ` · ${host.capabilities.chrome === null ? 'no Chrome' : 'Chrome'}${host.capabilities.graphical ? '' : ', no display'}`}</div></td>
            <td>{host.online ? <span>● online</span> : <span className="muted">offline · last seen {ago(host.lastSeen)}</span>}{host.users.length > 0 ? <div className="muted">used by {host.users.join(', ')}</div> : null}</td>
            <td>{host.mine ? (
              <select value={host.sharing} onChange={(event) => void api.setHostSharing(host.id, event.target.value as 'private' | 'home').then(refresh)}>
                <option value="private">Only my robots</option>
                <option value="home">Shared with the Home</option>
              </select>
            ) : <span className="muted">{host.ownerName}'s, shared</span>}</td>
            <td>{host.mine ? <button type="button" className="link" onClick={() => { if (confirm(`Unpair ${host.name}? Its app disconnects and must be paired again.`)) void api.unpairHost(host.id).then(refresh) }}>Unpair</button> : null}</td>
          </tr>
        ))}</tbody></table>
      )}
    </>
  )
}

/** The page the app opens to pair a computer (hs-hend): signed in through Access, one tap. */
export function PairHost({ code }: { code: string }) {
  const [pending, setPending] = useState<{ name: string; platform: string; approved: boolean }>()
  const [result, setResult] = useState<string>()
  useEffect(() => { void api.pairing(code).then(setPending).catch((error: unknown) => setResult(error instanceof ApiError ? error.message : 'unknown pairing code')) }, [code])
  if (result !== undefined) return result.startsWith('Paired ') ? <div className="form"><Empty title="Paired" hint={result} /></div> : <div className="form"><ErrorState title="This computer cannot be paired" message={result} /></div>
  if (pending === undefined) return <Loading what="the pairing" />
  return (
    <div className="form">
      <p>Pair the computer <b>{pending.name}</b> ({pending.platform}) with your Mr. Robot? Robots you grant it can then use its files, a shell as you, and its Chrome while the app runs.</p>
      <p className="muted">Code {code}: check it matches the one in the app.</p>
      {pending.approved ? <p>Already paired.</p> : (
        <div className="question-actions">
          <button type="button" className="button button-primary" onClick={() => void api.approvePairing(code).then((paired) => setResult(`Paired ${paired.name}. You can close this tab; the app connects by itself.`)).catch((error: unknown) => setResult(error instanceof ApiError ? error.message : 'could not pair'))}>Pair this computer</button>
        </div>
      )}
    </div>
  )
}
