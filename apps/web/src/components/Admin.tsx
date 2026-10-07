import { useCallback, useEffect, useState } from 'react'
import type { AdminView } from '@mr-robot/protocol'
import { api, ApiError } from '../api.ts'
import { go } from '../route.ts'
import { ConfirmButton } from './RobotSheets.tsx'

const usd = (value: number) => `$${value.toFixed(2)}`
const tokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)

/** The Home admin's single place (robot-x26m, robot-1rap, robot-bvme, robot-d2uv). */
export function Admin() {
  const [view, setView] = useState<AdminView>()
  const [message, setMessage] = useState<string>()
  const refresh = useCallback(() => api.admin().then(setView, (cause: unknown) => setMessage(cause instanceof ApiError ? cause.message : 'failed')), [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [refresh])
  const run = async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action()
      setMessage(done)
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'failed')
    }
    await refresh()
  }
  if (view === undefined) return <div className="muted">{message ?? 'Loading…'}</div>
  return (
    <div className="form">
      {message === undefined ? null : <div className="muted">{message}</div>}
      <h2>Robots</h2>
      <table className="grid">
        <thead><tr><th>Robot</th><th>Owner</th><th>State</th><th>Model</th><th>Grants</th><th>This month</th></tr></thead>
        <tbody>
          {view.fleet.map((robot) => (
            <tr key={robot.id}>
              <td><button type="button" className="link" onClick={() => go({ page: 'robot', id: robot.id, panel: false })}>{robot.identity.name}</button>{robot.sharing === 'home' ? <div className="muted">shared</div> : null}</td>
              <td>{robot.ownerName}</td>
              <td><span className={`state state-${robot.fleetState.split(' ')[0]}`}>{robot.fleetState}</span></td>
              <td>{robot.model.model}<div className="muted">{robot.model.effort}</div></td>
              <td className="muted">{[...robot.grants.tools, ...robot.grants.skills.map((name) => `skill:${name}`), ...robot.grants.secrets.map((name) => `secret:${name}`)].join(', ') || 'none'}{robot.grants.recipients.length === 0 ? '' : ` · ${robot.grants.recipients.length} recipients`}</td>
              <td>{usd(robot.usage.costUsd)}<div className="muted">{tokens(robot.usage.inputTokens + robot.usage.outputTokens)} tokens</div></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Routines</h2>
      {view.routines.length === 0 ? <div className="muted">No routines.</div> : (
        <table className="grid">
          <thead><tr><th>Next run</th><th>Routine</th><th>Robot</th><th>Schedule</th></tr></thead>
          <tbody>
            {view.routines.map((routine) => (
              <tr key={`${routine.robotId}-${routine.id}`}>
                <td>{routine.nextRun === null ? '—' : new Date(routine.nextRun).toLocaleString()}</td>
                <td>{routine.name}</td>
                <td>{routine.robotName}<div className="muted">{routine.ownerName}</div></td>
                <td className="muted">{routine.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Members and costs</h2>
      <table className="grid">
        <thead><tr><th>Member</th><th>Status</th><th>This month</th><th /></tr></thead>
        <tbody>
          {view.members.map((member) => (
            <tr key={member.id}>
              <td>{member.name}<div className="muted">{member.email}</div></td>
              <td>{member.role === 'admin' ? 'admin' : member.status}</td>
              <td>{usd(member.usage.costUsd)}<div className="muted">{tokens(member.usage.inputTokens + member.usage.outputTokens)} tokens</div></td>
              <td>{member.role === 'admin' || member.status === 'removed' ? null : <ConfirmButton label="Remove" confirm="Remove and pause their Robots" onConfirm={() => void run(() => api.removeMember(member.id), 'Removed.')} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Invite onInvite={(email) => run(() => api.invite(email), `Invited ${email}. They join on first sign-in.`)} />

      <h2>Home settings</h2>
      <HomeSettings view={view} onSave={(patch) => run(() => api.updateHomeSettings(patch), 'Saved.')} />
      <h2>Exa</h2>
      <ExaKey configured={view.exaConfigured === true} onSave={(key) => run(() => api.setExaKey(key), key === null ? 'Removed.' : 'Saved.')} />
      <h2>Proton VPN</h2>
      <VpnConfig configured={view.vpnConfigured === true} onSave={(config) => run(() => api.setVpnConfig(config), config === null ? 'Removed.' : 'Saved.')} />

      <h2>Model lists</h2>
      <div className="muted">Each Provider's own list of models, fetched with a connected key or subscription and refreshed daily. Robots choose from these.</div>
      <table className="grid"><tbody>
        {(view.modelLists ?? []).map((list) => (
          <tr key={list.provider}>
            <td>{list.provider}</td>
            <td>{list.count} models</td>
            <td className="muted">{list.error !== null ? `last refresh failed: ${list.error}` : list.fetchedAt === null ? '' : `fetched ${new Date(list.fetchedAt).toLocaleString()}`}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="question-actions"><button type="button" className="button" onClick={() => void run(async () => { const result = await api.refreshModels(); setMessage(result.map((entry) => `${entry.provider}: ${entry.error ?? `${entry.count} models`}`).join(' · ')) })}>Refresh models</button></div>

      <h2>Providers</h2>
      {view.providers.length === 0 ? <div className="muted">No Provider connected yet. Connect one on your profile page.</div> : (
        <table className="grid"><tbody>{view.providers.map((entry) => <tr key={`${entry.provider}-${entry.ownerName}`}><td>{entry.provider}</td><td>{entry.ownerName}</td><td>{entry.shared ? 'shared with the Home' : 'private'}</td></tr>)}</tbody></table>
      )}

      <h2>Skill library</h2>
      <SkillLibrary view={view} onChanged={() => run(async () => undefined, 'Saved.')} />
      <details className="prompt-section">
        <summary>Sync from a Git repository (optional)</summary>
        <SkillRepository view={view} onSave={(input) => run(() => api.setSkillRepository(input), 'Saved.')} onSync={() => run(async () => { const result = await api.syncSkills(); setMessage(`Synced ${result.synced.length} skills.`) })} />
        <div className="muted">Imported skills stay editable; a skill you edit here is kept as it is by later syncs.</div>
      </details>
    </div>
  )
}

function Invite({ onInvite }: { onInvite: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  return (
    <div className="form inline">
      <input type="email" value={email} placeholder="e-mail to invite" onChange={(event) => setEmail(event.target.value)} />
      <button type="button" className="button" disabled={!email.includes('@')} onClick={() => void onInvite(email).then(() => setEmail(''))}>Invite</button>
    </div>
  )
}

function HomeSettings({ view, onSave }: { view: AdminView; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const [model, setModel] = useState(`${view.settings.defaultModel.provider}/${view.settings.defaultModel.model}`)
  const [robotLimit, setRobotLimit] = useState(view.settings.robotSpendLimitUsd?.toString() ?? '')
  const [memberLimit, setMemberLimit] = useState(view.settings.memberSpendLimitUsd?.toString() ?? '')
  const [backend, setBackend] = useState(view.settings.defaultBrowserBackend ?? 'browser-run')
  const save = () => {
    const option = view.settings.models.find((entry) => `${entry.provider}/${entry.model}` === model)
    void onSave({
      ...(option === undefined ? {} : { defaultModel: { provider: option.provider, model: option.model, effort: view.settings.defaultModel.effort } }),
      defaultBrowserBackend: backend,
      robotSpendLimitUsd: robotLimit === '' ? null : Number(robotLimit),
      memberSpendLimitUsd: memberLimit === '' ? null : Number(memberLimit),
    })
  }
  return (
    <>
      <label>Default model for new Robots
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          {view.settings.models.map((option) => <option key={`${option.provider}/${option.model}`} value={`${option.provider}/${option.model}`}>{option.label}</option>)}
        </select>
      </label>
      <label>Default browser for Robots
        <select aria-label="Default browser backend" value={backend} onChange={(event) => setBackend(event.target.value as typeof backend)}>
          {(view.browserBackends ?? []).map((option) => <option key={option.id} value={option.id} disabled={!option.available}>{option.label}{option.available ? '' : ' (not available)'}</option>)}
        </select>
        <small className="muted">{(view.browserBackends ?? []).find((option) => option.id === backend)?.note ?? ''}</small>
      </label>
      <div className="form inline">
        <label>Robot limit, USD/month<input type="number" min={0} value={robotLimit} onChange={(event) => setRobotLimit(event.target.value)} /></label>
        <label>Member limit, USD/month<input type="number" min={0} value={memberLimit} onChange={(event) => setMemberLimit(event.target.value)} /></label>
      </div>
      <div className="question-actions"><button type="button" className="button button-primary" onClick={save}>Save</button></div>
    </>
  )
}

function SkillRepository({ view, onSave, onSync }: { view: AdminView; onSave: (input: { repo: string; ref: string; path: string; token?: string }) => Promise<void>; onSync: () => Promise<void> }) {
  const [repo, setRepo] = useState(view.skillRepository?.repo ?? '')
  const [ref, setRef] = useState(view.skillRepository?.ref ?? 'main')
  const [path, setPath] = useState(view.skillRepository?.path ?? 'skills')
  const [token, setToken] = useState('')
  return (
    <div className="form">
      <div className="form inline">
        <input value={repo} placeholder="owner/repository" onChange={(event) => setRepo(event.target.value)} />
        <input value={ref} placeholder="branch" onChange={(event) => setRef(event.target.value)} />
        <input value={path} placeholder="directory" onChange={(event) => setPath(event.target.value)} />
        <input type="password" value={token} placeholder="GitHub token (private repos)" onChange={(event) => setToken(event.target.value)} />
      </div>
      <div className="question-actions">
        <button type="button" className="button" onClick={() => void onSave({ repo, ref, path, ...(token === '' ? {} : { token }) })}>Save</button>
        <button type="button" className="button button-primary" disabled={view.skillRepository === null} onClick={() => void onSync()}>Sync now</button>
      </div>
    </div>
  )
}

/** The Home's Proton VPN WireGuard configuration (rb-rb1x): write-only; robots on "Container Chrome via VPN" use it. */
function VpnConfig({ configured, onSave }: { configured: boolean; onSave: (config: string | null) => Promise<void> }) {
  const [config, setConfig] = useState('')
  return (
    <div className="form">
      <p className="muted">{configured ? 'A WireGuard configuration is stored. Paste a new one to replace it.' : 'Paste the WireGuard configuration of a Proton VPN server in Poland (Proton account → Downloads → WireGuard configuration). It is stored encrypted and never shown again.'}</p>
      <textarea aria-label="WireGuard configuration" rows={6} value={config} placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …'} onChange={(event) => setConfig(event.target.value)} />
      <div className="question-actions">
        {configured && <button type="button" className="button" onClick={() => void onSave(null)}>Remove</button>}
        <button type="button" className="button button-primary" disabled={config.trim() === ''} onClick={() => void onSave(config).then(() => setConfig(''))}>Save</button>
      </div>
    </div>
  )
}

/** The Home library (rb-5ku3): every global skill opens in an editor; create and delete. */
function SkillLibrary({ view, onChanged }: { view: AdminView; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<{ name: string; description: string; content: string; isNew: boolean } | null>(null)
  const [error, setError] = useState<string>()
  const open = async (name: string, description: string) => setEditing({ name, description, content: (await api.skill(name)).content, isNew: false })
  const save = async () => {
    if (editing === null) return
    try {
      await api.saveSkill(editing.name, editing.description, editing.content)
      setEditing(null)
      setError(undefined)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'could not save')
    }
  }
  return (
    <div className="form">
      {view.skills.length === 0 ? <div className="muted">The library is empty. Robots get only the skills you put here and grant them.</div> : (
        <table className="grid"><tbody>{view.skills.map((skill) => (
          <tr key={skill.name}>
            <td>{skill.name}</td>
            <td className="muted">{skill.description}</td>
            <td className="muted">{skill.source === 'git' ? (skill.edited === true ? 'from Git, edited' : 'from Git') : skill.source === 'robot' ? `from a Robot (${skill.visibility})` : 'written here'}</td>
            <td><span className="form inline">
              <button type="button" className="link" onClick={() => void open(skill.name, skill.description)}>Edit</button>
              <button type="button" className="link" onClick={() => { if (confirm(`Delete the skill ${skill.name}?`)) void api.deleteSkill(skill.name).then(onChanged) }}>Delete</button>
            </span></td>
          </tr>
        ))}</tbody></table>
      )}
      {editing === null
        ? <div><button type="button" className="button" onClick={() => setEditing({ name: '', description: '', content: '---\nname: \ndescription: \n---\n\n', isNew: true })}>New skill</button></div>
        : (
          <div className="form login-form">
            <label>Name<input value={editing.name} disabled={!editing.isNew} placeholder="lowercase-with-dashes" onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label>Description<input value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
            <label>SKILL.md<textarea className="file-text" style={{ minHeight: '40vh' }} value={editing.content} spellCheck={false} onChange={(event) => setEditing({ ...editing, content: event.target.value })} /></label>
            <div className="question-actions">
              {error === undefined ? null : <span className="muted">{error}</span>}
              <button type="button" className="button" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="button button-primary" disabled={editing.name === '' || editing.description === ''} onClick={() => void save()}>Save</button>
            </div>
          </div>
        )}
    </div>
  )
}

/** The Home's Exa API key (rb-x8i3): write-only; Robots granted "exa" use it. */
function ExaKey({ configured, onSave }: { configured: boolean; onSave: (key: string | null) => Promise<void> }) {
  const [key, setKey] = useState('')
  return (
    <div className="form">
      <p className="muted">{configured ? 'An Exa API key is stored. Robots granted Exa research or Exa agent runs use it; each call counts in their usage.' : 'Add an Exa API key (dashboard.exa.ai → API keys) so Robots granted Exa research can search with it. It is stored encrypted and never shown again.'}</p>
      <div className="form inline">
        <input type="password" aria-label="Exa API key" value={key} placeholder="Exa API key" onChange={(event) => setKey(event.target.value)} />
        {configured && <button type="button" className="button" onClick={() => void onSave(null)}>Remove</button>}
        <button type="button" className="button button-primary" disabled={key.trim() === ''} onClick={() => void onSave(key).then(() => setKey(''))}>Save</button>
      </div>
    </div>
  )
}
