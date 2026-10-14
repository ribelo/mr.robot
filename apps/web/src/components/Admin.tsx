import { useEffect, useState } from 'react'
import { useAtomRefresh } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import { spendLimitText, type AdminView, type GrantLevels, type ModelChoice, type VpnSummary } from '@mr-robot/protocol'
import * as Option from 'effect/Option'
import { adminAtom, homeMemoryAtom, keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { AtomView } from './AtomView.tsx'
import { go } from '../route.ts'
import { ConfirmButton } from './RobotSheets.tsx'
import { SaveButton } from './SaveButton.tsx'
import { ModelSelect } from './ModelSelect.tsx'
import { parseHomeSpendLimit, SpendLimitChoice, spendLimitDraft } from './SpendLimitChoice.tsx'
import { Avatar, MemberFace } from './Avatar.tsx'

const usd = (value: number) => `$${value.toFixed(2)}`
const tokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)

/** The Home admin's single place (robot-x26m, robot-1rap, robot-bvme, robot-d2uv). */
export function Admin() {
  const refresh = useAtomRefresh(adminAtom)
  // Robots change state by themselves; the view reads again every 15 seconds.
  useEffect(() => {
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
  }, [refresh])
  return <AtomView atom={adminAtom} what="the Home" errorTitle="The admin view cannot be loaded">{(view) => <AdminPage view={view} />}</AtomView>
}

/** Items a Robot may use, an ask item marked (sk-746n). */
function grantNames(levels: GrantLevels, prefix: string): string[] {
  return Object.entries(levels).filter(([, level]) => level !== 'deny').map(([name, level]) => `${prefix}${name}${level === 'ask' ? ' (ask)' : ''}`)
}

function AdminPage({ view }: { view: AdminView }) {
  const command = useCommand()
  const [message, setMessage] = useState<string>()
  /** Run a change; done is the message on success, or a function of the result; a save has none, its button says Saved. True when it succeeded. */
  const run = async <A,>(action: Parameters<typeof command<A>>[0], done?: string | ((value: A) => string)) => {
    const exit = await command(action, [keys.admin, keys.robots, keys.hosts])
    setMessage(Exit.isSuccess(exit) ? (typeof done === 'function' ? done(exit.value) : done) : exitFailure(exit))
    return Exit.isSuccess(exit)
  }
  return (
    <div className="form">
      {message === undefined ? null : <div className="muted">{message}</div>}
      <h2>Robots</h2>
      <table className="grid">
        <thead><tr><th>Robot</th><th>Owner</th><th>State</th><th>Model</th><th>Grants</th><th>This month</th><th>Limit</th></tr></thead>
        <tbody>
          {view.fleet.map((robot) => (
            <tr key={robot.id}>
              <td><span className="avatar-cell"><Avatar seed={robot.identity.avatarSeed} color={robot.identity.avatarColor} size={22} state={robot.fleetState} /><button type="button" className="link" onClick={() => go({ page: 'robot', id: robot.id, panel: false })}>{robot.identity.name}</button></span>{robot.sharing === 'home' ? <div className="muted">shared</div> : null}</td>
              <td>{robot.ownerName}</td>
              <td><span className={`state state-${robot.fleetState.split(' ')[0]}`}>{robot.fleetState}</span></td>
              <td>{robot.model.model}<div className="muted">{robot.model.effort}</div></td>
              <td className="muted">{[...grantNames(robot.grants.tools, ''), ...grantNames(robot.grants.skills, 'skill:'), ...grantNames(robot.grants.secrets, 'secret:')].join(', ') || 'none'}{Object.keys(robot.grants.recipients).length === 0 ? '' : ` · ${Object.keys(robot.grants.recipients).length} recipients`}</td>
              <td>{usd(robot.usage.costUsd)}<div className="muted">{tokens(robot.usage.inputTokens + robot.usage.outputTokens)} tokens</div></td>
              <td>{spendLimitText(robot.usage.limit)}</td>
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

      <h2>Threads</h2>
      {(view.threads ?? []).length === 0 ? <div className="muted">No Threads between chiefs.</div> : (
        <table className="grid">
          <thead><tr><th>Topic</th><th>Chiefs</th><th>State</th><th>Messages</th><th>Last message</th></tr></thead>
          <tbody>
            {(view.threads ?? []).map((thread) => (
              <tr key={thread.id}>
                <td>{thread.topic}</td>
                <td>{thread.participants.map((participant) => participant.chiefName).join(' and ')}</td>
                <td>{thread.state}</td>
                <td>{thread.messageCount}</td>
                <td className="muted">{new Date(thread.lastActivityAt).toLocaleString()}</td>
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
              <td><span className="avatar-cell"><MemberFace memberId={member.id} name={member.name} avatar={member.avatar} size={22} /><span>{member.name}<div className="muted">{member.email}</div></span></span></td>
              <td>{member.role === 'admin' ? 'admin' : member.status}</td>
              <td>{usd(member.usage.costUsd)}<div className="muted">{tokens(member.usage.inputTokens + member.usage.outputTokens)} tokens</div></td>
              <td>{member.role === 'admin' || member.status === 'removed' ? null : <ConfirmButton label="Remove" confirm="Remove and pause their Robots" onConfirm={() => void run((api) => api.removeMember(member.id), 'Removed.')} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Invite onInvite={(email) => run((api) => api.invite(email), `Invited ${email}. They join on first sign-in.`)} />

      <h2>Home settings</h2>
      <HomeSettings view={view} />
      <h2>Hosts</h2>
      {(view.hosts ?? []).length === 0 ? <div className="muted">No computers paired in this Home.</div> : (
        <table className="grid"><tbody>{(view.hosts ?? []).map((host) => (
          <tr key={host.id}>
            <td><b>{host.name}</b><div className="muted">{host.ownerName} · {host.sharing === 'home' ? 'shared with the Home' : 'private'}</div></td>
            <td>{host.online ? '● online' : 'offline'}<div className="muted">last seen {host.lastSeen === null ? 'never' : new Date(host.lastSeen).toLocaleString()}</div></td>
            <td className="muted">{host.platform}{host.version === null ? '' : ` · app ${host.version}`}{host.capabilities === null ? '' : ` · ${host.capabilities.chrome === null ? 'no Chrome' : 'Chrome'}${host.capabilities.graphical ? '' : ' · no display'}`}</td>
            <td className="muted">{host.users.length === 0 ? 'not in use' : `used by ${host.users.join(', ')}`}</td>
          </tr>
        ))}</tbody></table>
      )}
      <h2>Home memory</h2>
      <AtomView atom={homeMemoryAtom}>{(file) => <HomeMemory initial={file.content} />}</AtomView>
      <h2>Proxy</h2>
      <ProxyConfig configured={view.proxyConfigured === true} onSave={(url) => run((api) => api.setProxy(url), url === null ? 'Removed.' : undefined)} />
      <h2>Exa</h2>
      <ExaKey configured={view.exaConfigured === true} onSave={(key) => run((api) => api.setExaKey(key), key === null ? 'Removed.' : undefined)} />
      <h2>Proton VPN</h2>
      <VpnConfig summary={view.vpnSummary} onSave={(config) => run((api) => api.setVpnConfig(config), config === null ? 'Removed.' : undefined)} />

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
      <div className="question-actions"><button type="button" className="button" onClick={() => void run((api) => api.refreshModels, (result) => result.map((entry) => `${entry.provider}: ${entry.error ?? `${entry.count} models`}`).join(' · '))}>Refresh models</button></div>

      <h2>Providers</h2>
      {view.providers.length === 0 ? <div className="muted">No Provider connected yet. Connect one on your profile page.</div> : (
        <table className="grid"><tbody>{view.providers.map((entry) => <tr key={entry.id}><td>{entry.provider}</td><td>{entry.label}</td><td>{entry.ownerName}</td><td>{entry.shared ? 'shared with the Home' : 'private'}</td></tr>)}</tbody></table>
      )}

      <h2>Skill library</h2>
      <SkillLibrary view={view} onMessage={setMessage} />
      <details className="prompt-section">
        <summary>Sync from a Git repository (optional)</summary>
        <SkillRepository view={view} onSave={(input) => run((api) => api.setSkillRepository(input))} onSync={() => run((api) => api.syncSkills, (result) => `Synced ${result.synced.length} skills.`)} />
        <div className="muted">Imported skills stay editable; a skill you edit here is kept as it is by later syncs.</div>
      </details>
    </div>
  )
}

function Invite({ onInvite }: { onInvite: (email: string) => Promise<boolean> }) {
  const [email, setEmail] = useState('')
  return (
    <div className="form inline">
      <input type="email" value={email} placeholder="e-mail to invite" onChange={(event) => setEmail(event.target.value)} />
      <button type="button" className="button" disabled={!email.includes('@')} onClick={() => void onInvite(email).then(() => setEmail(''))}>Invite</button>
    </div>
  )
}

/**
 * Home settings: the Workers AI switch (ux-101w), the default model chosen with the Provider-grouped
 * combobox (ux-3l7i), the default browser and the spend limits. Switching Workers AI off can move the
 * default model; the save answer says where, and a note tells the admin (ux-jseo).
 */
function HomeSettings({ view }: { view: AdminView }) {
  const command = useCommand()
  const [model, setModel] = useState<ModelChoice>(view.settings.defaultModel)
  const [workersAi, setWorkersAi] = useState(view.settings.workersAiEnabled)
  const [robotLimit, setRobotLimit] = useState(spendLimitDraft(view.settings.robotSpendLimit))
  const [memberLimit, setMemberLimit] = useState(spendLimitDraft(view.settings.memberSpendLimit))
  const robotSpendLimit = parseHomeSpendLimit(robotLimit)
  const memberSpendLimit = parseHomeSpendLimit(memberLimit)
  const [backend, setBackend] = useState(view.settings.defaultBrowserBackend ?? 'browser-run')
  const [moved, setMoved] = useState<string>()
  const [error, setError] = useState<string>()
  const labelOf = (choice: ModelChoice) => view.settings.models.find((option) => option.provider === choice.provider && option.model === choice.model)?.label ?? choice.model
  const save = async () => {
    // An amount that is not whole dollars of at least 1 is shown under its field and not sent.
    if (Option.isNone(robotSpendLimit) || Option.isNone(memberSpendLimit)) return false
    const exit = await command((api) => api.updateHomeSettings({
      defaultModel: model,
      workersAiEnabled: workersAi,
      defaultBrowserBackend: backend,
      robotSpendLimit: robotSpendLimit.value,
      memberSpendLimit: memberSpendLimit.value,
    }), [keys.admin, keys.robots, keys.hosts, keys.providers])
    setError(exitFailure(exit))
    if (Exit.isSuccess(exit)) {
      setModel(exit.value.defaultModel)
      setMoved(exit.value.defaultModelMoved === undefined ? undefined : `Default model moved to ${labelOf(exit.value.defaultModelMoved.to)}.`)
    }
    return exit
  }
  // Workers AI is off but no other model is usable: the default stays where it was.
  const stuck = !view.settings.workersAiEnabled && view.settings.defaultModel.provider === 'workers-ai'
  return (
    <>
      <div className="toggle-card">
        <div>
          <div>Workers AI</div>
          <div className="muted">Models on this Cloudflare account, free of charge. Off: nobody in the Home can pick them and chains skip them.</div>
        </div>
        <button type="button" role="switch" aria-checked={workersAi} aria-label="Workers AI" className={workersAi ? 'switch on' : 'switch'} onClick={() => setWorkersAi(!workersAi)}><span /></button>
      </div>
      <label>Default model for new Robots
        <ModelSelect value={model} models={view.settings.models} unavailable={[]} disabledProviders={view.settings.workersAiEnabled ? [] : ['workers-ai']}
          onChange={(option) => setModel({ provider: option.provider, model: option.model, effort: model.effort })} />
      </label>
      {moved === undefined ? null : <div className="muted">{moved}</div>}
      {stuck ? <div className="muted">No other model is usable, so the default model stays on Workers AI. Connect a Provider on your profile.</div> : null}
      <label>Default browser for Robots
        <select aria-label="Default browser backend" value={backend} onChange={(event) => setBackend(event.target.value as typeof backend)}>
          {(view.browserBackends ?? []).map((option) => <option key={option.id} value={option.id} disabled={!option.available}>{option.label}{option.available ? '' : ' (not available)'}</option>)}
        </select>
        <small className="muted">{(view.browserBackends ?? []).find((option) => option.id === backend)?.note ?? ''}</small>
      </label>
      <div className="form inline spend-limits">
        <SpendLimitChoice label="Spend limit per Robot" kinds={['none', 'usd']} draft={robotLimit} valid={Option.isSome(robotSpendLimit)} note="Each Robot that follows the Home's limit, per month." onChange={setRobotLimit} />
        <SpendLimitChoice label="Spend limit per Member" kinds={['none', 'usd']} draft={memberLimit} valid={Option.isSome(memberSpendLimit)} note="All Robots of one Member together, per month." onChange={setMemberLimit} />
      </div>
      <div className="question-actions">{error === undefined ? null : <span className="muted">{error}</span>}<SaveButton onSave={save} /></div>
    </>
  )
}

function SkillRepository({ view, onSave, onSync }: { view: AdminView; onSave: (input: { repo: string; ref: string; path: string; token?: string }) => Promise<boolean>; onSync: () => Promise<boolean> }) {
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
        <SaveButton secondary onSave={() => onSave({ repo, ref, path, ...(token === '' ? {} : { token }) })} />
        <button type="button" className="button button-primary" disabled={view.skillRepository === null} onClick={() => void onSync()}>Sync now</button>
      </div>
    </div>
  )
}

/** "Poland (PL)" for a country code; the code alone where the browser has no name for it. */
const countryName = (code: string) => {
  const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
  return name === undefined || name === code ? code : `${name} (${code})`
}

/**
 * The Home's Proton VPN WireGuard configuration (rb-rb1x): write-only; robots on "Container Chrome via VPN" use it.
 * Once stored, the card shows its public summary: endpoint, server name and country (ux-t4wi); never a key (ux-a3ec).
 */
function VpnConfig({ summary, onSave }: { summary: VpnSummary | undefined; onSave: (config: string | null) => Promise<boolean> }) {
  const [config, setConfig] = useState('')
  const configured = summary !== undefined
  return (
    <div className="form">
      {summary === undefined ? null : (
        <table className="grid" aria-label="Stored VPN"><tbody>
          <tr><td>Endpoint</td><td>{summary.endpoint}</td></tr>
          {summary.serverName === undefined ? null : <tr><td>Server</td><td>{summary.serverName}</td></tr>}
          {summary.country === undefined ? null : <tr><td>Country</td><td>{countryName(summary.country)}</td></tr>}
        </tbody></table>
      )}
      <p className="muted">{configured ? 'A WireGuard configuration is stored. Paste a new one to replace it.' : 'Paste the WireGuard configuration of a Proton VPN server in Poland (Proton account → Downloads → WireGuard configuration). It is stored encrypted and never shown again.'}</p>
      <textarea aria-label="WireGuard configuration" rows={6} value={config} placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …'} onChange={(event) => setConfig(event.target.value)} />
      <div className="question-actions">
        {configured && <button type="button" className="button" onClick={() => void onSave(null)}>Remove</button>}
        <SaveButton disabled={config.trim() === ''} onSave={async () => { const saved = await onSave(config); if (saved) setConfig(''); return saved }} />
      </div>
    </div>
  )
}

/** The Home library (rb-5ku3): every global skill opens in an editor; create and delete. */
function SkillLibrary({ view, onMessage }: { view: AdminView; onMessage: (message: string | undefined) => void }) {
  const command = useCommand()
  const [editing, setEditing] = useState<{ name: string; description: string; content: string; isNew: boolean } | null>(null)
  const [error, setError] = useState<string>()
  const open = async (name: string, description: string) => {
    const exit = await command((api) => api.skill(name), [])
    if (Exit.isSuccess(exit)) setEditing({ name, description, content: exit.value.content, isNew: false })
    else setError(exitFailure(exit))
  }
  const save = async () => {
    if (editing === null) return false
    const failure = exitFailure(await command((api) => api.saveSkill(editing.name, editing.description, editing.content), [keys.admin]))
    setError(failure)
    // A saved skill closes its editor; the table shows it.
    if (failure === undefined) setEditing(null)
    return failure === undefined
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
              <button type="button" className="link" onClick={() => { if (confirm(`Delete the skill ${skill.name}?`)) void command((api) => api.deleteSkill(skill.name), [keys.admin]).then((exit) => onMessage(exitFailure(exit) ?? 'Deleted.')) }}>Delete</button>
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
              <SaveButton disabled={editing.name === '' || editing.description === ''} onSave={save} />
            </div>
          </div>
        )}
    </div>
  )
}

/** The Home's Exa API key (rb-x8i3): write-only; Robots granted "exa" use it. */
function ExaKey({ configured, onSave }: { configured: boolean; onSave: (key: string | null) => Promise<boolean> }) {
  const [key, setKey] = useState('')
  return (
    <div className="form">
      <p className="muted">{configured ? 'An Exa API key is stored. Robots granted Exa research or Exa agent runs use it; each call counts in their usage.' : 'Add an Exa API key (dashboard.exa.ai → API keys) so Robots granted Exa research can search with it. It is stored encrypted and never shown again.'}</p>
      <div className="form inline">
        <input type="password" aria-label="Exa API key" value={key} placeholder="Exa API key" onChange={(event) => setKey(event.target.value)} />
        {configured && <button type="button" className="button" onClick={() => void onSave(null)}>Remove</button>}
        <SaveButton disabled={key.trim() === ''} onSave={async () => { const saved = await onSave(key); if (saved) setKey(''); return saved }} />
      </div>
    </div>
  )
}

/** The proxy address for "Container Chrome via proxy" (v1.2 ticket 05): write-only. */
function ProxyConfig({ configured, onSave }: { configured: boolean; onSave: (url: string | null) => Promise<boolean> }) {
  const [url, setUrl] = useState('')
  return (
    <div className="form">
      <p className="muted">{configured ? 'A proxy address is stored; "Container Chrome via proxy" is available.' : 'A proxy address (for example from a residential proxy provider) makes "Container Chrome via proxy" available. Format: http://user:password@host:port or socks5://user:password@host:port. Stored encrypted.'}</p>
      <div className="form inline">
        <input type="password" aria-label="Proxy address" value={url} placeholder="http://user:password@host:port" onChange={(event) => setUrl(event.target.value)} />
        {configured && <button type="button" className="button" onClick={() => void onSave(null)}>Remove</button>}
        <SaveButton disabled={url.trim() === ''} onSave={async () => { const saved = await onSave(url); if (saved) setUrl(''); return saved }} />
      </div>
    </div>
  )
}

/** HOME.md (pl-yqno): household facts every Robot of the Home reads; the admin and Mr. Robot write it. */
function HomeMemory({ initial }: { initial: string }) {
  const command = useCommand()
  const [content, setContent] = useState(initial)
  const [stored, setStored] = useState(initial)
  const [error, setError] = useState<string>()
  const save = async () => {
    const written = content
    const exit = await command((api) => api.setHomeMemory(written), [keys.homeMemory])
    setError(exitFailure(exit))
    if (Exit.isSuccess(exit)) setStored(written)
    return exit
  }
  return (
    <div className="form">
      <div className="muted">Facts for every Robot in the Home: the electricity provider, the building, shared accounts. Each Robot is told when it changes.</div>
      <label>HOME.md
        <textarea rows={6} value={content} placeholder="# HOME.md" onChange={(event) => setContent(event.target.value)} />
      </label>
      <div className="question-actions">{error === undefined ? null : <span className="muted">{error}</span>}<SaveButton onSave={save} disabled={content === stored} /></div>
    </div>
  )
}
