import { ConfirmByName } from './ConfirmByName.tsx'
import { hostBridge } from './ThisComputer.tsx'
import { WORK_DETAILS } from './WorkDetails.tsx'
import { Hosts } from './Hosts.tsx'
import { Connections } from './Connections.tsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useAtomValue } from '@effect/atom-react'
import * as Exit from 'effect/Exit'
import type { Me, ProviderView, ProvidersView, ThemeChoice } from '@mr-robot/protocol'
import { applyTheme } from '../theme/theme.ts'
import { keys, memberFileAtom, providersAtom, secretsAtom, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { AtomView } from './AtomView.tsx'

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude', note: 'Your Claude plans, signed in with Anthropic.', kind: 'oauth' },
  { id: 'openai', name: 'ChatGPT', note: 'Your ChatGPT plans, signed in with OpenAI.', kind: 'oauth' },
  { id: 'opencode-go', name: 'OpenCode Go', note: 'Every model of the plan, one API key per account.', kind: 'api-key' },
  { id: 'deepseek', name: 'DeepSeek', note: 'DeepSeek models with your API key.', kind: 'api-key' },
  { id: 'openrouter', name: 'OpenRouter', note: 'Hundreds of models with one API key.', kind: 'api-key' },
] as const

/** A Member's own settings: profile, quiet hours, Provider credentials, Member files. */
export function Profile({ me }: { me: Me }) {
  return (
    <div className="form">
      <Preferences me={me} />
      <ThemeSetting me={me} />
      <WorkDetailsSetting me={me} />
      <ResetEverything me={me} />
      <DeviceNotifications vapidPublicKey={me.vapidPublicKey} />
      <Providers />
      <Connections />
      <Secrets />
      <Hosts />
      <MemberFiles />
    </div>
  )
}

function Preferences({ me }: { me: Me }) {
  const command = useCommand()
  const [name, setName] = useState(me.name)
  const [timeZone, setTimeZone] = useState(me.timeZone)
  const [quiet, setQuiet] = useState(me.quietHours ?? { start: '', end: '' })
  const [saved, setSaved] = useState<string>()
  const save = async () => {
    const exit = await command((api) => api.updateMe({ name, timeZone, quietHours: quiet.start !== '' && quiet.end !== '' ? quiet : null }), [keys.me, keys.robots, keys.admin])
    setSaved(exitFailure(exit) ?? 'Saved.')
  }
  return (
    <>
      <h2>You</h2>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Time zone<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="Europe/Warsaw" /></label>
      <div className="form inline">
        <label>Quiet from<input type="time" value={quiet.start} onChange={(event) => setQuiet({ ...quiet, start: event.target.value })} /></label>
        <label>until<input type="time" value={quiet.end} onChange={(event) => setQuiet({ ...quiet, end: event.target.value })} /></label>
      </div>
      <div className="question-actions">{saved === undefined ? null : <span className="muted">{saved}</span>}<button type="button" className="button button-primary" onClick={() => void save()}>Save</button></div>
    </>
  )
}

function Providers() {
  return <AtomView atom={providersAtom} what="Providers">{(view) => <ProviderList view={view} />}</AtomView>
}

function ProviderList({ view }: { view: ProvidersView }) {
  const [message, setMessage] = useState<string>()
  return (
    <>
      <h2>Providers</h2>
      <div className="muted">Your keys and subscriptions run your Robots. Add as many accounts as you have; share each one with the Home on its own. Each Robot's model chain says which accounts it uses.</div>
      {message === undefined ? null : <div className="muted">{message}</div>}
      <div className="providers">
        {PROVIDERS.map((provider) => (
          <div key={provider.id} className="provider provider-accounts">
            <div className="provider-head">
              <div className="provider-name"><div>{provider.name}</div><div className="muted">{provider.note}</div></div>
              <div className="provider-action"><Connect provider={provider} onDone={setMessage} /></div>
            </div>
            <AccountList accounts={view.mine.filter((account) => account.provider === provider.id)} mine />
            <AccountList accounts={view.shared.filter((account) => account.provider === provider.id)} mine={false} />
          </div>
        ))}
        <div className="provider">
          <div className="provider-name"><div>Workers AI</div><div className="muted">Models on Cloudflare, billed to this Cloudflare account.</div></div>
          <div className="provider-action"><span className="muted">Included</span></div>
        </div>
      </div>
    </>
  )
}

/** A Provider's accounts (v1.10): the person's own with their switches, or ones others share. */
function AccountList({ accounts, mine }: { accounts: readonly ProviderView[]; mine: boolean }) {
  const command = useCommand()
  const [error, setError] = useState<string>()
  const change = async (action: Parameters<typeof command>[0]) => setError(exitFailure(await command(action, [keys.providers])))
  if (accounts.length === 0) return null
  return (
    <ul className="connection-list">
      {accounts.map((account) => (
        <li key={account.id} className="connection">
          <div className="connection-name">
            <b>{account.label}</b>{mine ? null : <span className="muted"> · {account.ownerName}'s, shared</span>}
            {account.status === 'ok' ? null : <div className="host-log-failed">{account.status === 'limited' ? 'Limited' : 'Needs attention'}{account.note === null ? '' : `: ${account.note}`}{account.until === null ? '' : ` · tried again ${new Date(account.until).toLocaleString()}`}</div>}
          </div>
          {mine ? (
            <div className="connection-actions">
              <label className="check"><input type="checkbox" checked={account.shared} onChange={(event) => { const shared = event.target.checked; void change((api) => api.updateAccount(account.id, { shared })) }} /><span>Shared with the Home</span></label>
              <button type="button" className="link" onClick={() => { const label = prompt('Name of this account', account.label); if (label !== null && label.trim() !== '') void change((api) => api.updateAccount(account.id, { label })) }}>Rename</button>
              <button type="button" className="link danger" onClick={() => { if (confirm(`Remove ${account.label}? Robots that use it move on to the next entry of their model chain.`)) void change((api) => api.removeAccount(account.id)) }}>Remove</button>
            </div>
          ) : null}
          {error === undefined ? null : <div className="muted">{error}</div>}
        </li>
      ))}
    </ul>
  )
}

function Connect({ provider, onDone }: { provider: (typeof PROVIDERS)[number]; onDone: (message: string) => void }) {
  const command = useCommand()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [shared, setShared] = useState(false)
  const [flow, setFlow] = useState<{ url: string; userCode?: string }>()
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (provider.id !== 'openai' || flow === undefined) return
    // The device sign-in finishes on OpenAI's page; this page asks every few seconds whether it has.
    const timer = setInterval(() => {
      void command((api) => api.finishOAuth('openai', shared), [keys.providers]).then((exit) => {
        if (Exit.isSuccess(exit)) {
          if (exit.value.connected) {
            clearInterval(timer)
            onDone('ChatGPT account added.'); setOpen(false); setFlow(undefined)
          }
          return
        }
        clearInterval(timer)
        setError(exitFailure(exit))
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [flow, provider.id, shared, onDone, command])

  if (!open) return <button type="button" className="button" onClick={() => setOpen(true)}>Add account</button>
  const sharedBox = <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> share with the Home</label>
  if (provider.kind === 'api-key') {
    return (
      <span className="form">
        <input type="password" value={key} placeholder="API key" onChange={(event) => setKey(event.target.value)} />
        {sharedBox}
        {error === undefined ? null : <span className="muted">{error}</span>}
        <button type="button" className="button button-primary" onClick={() => void command((api) => api.addAccount(provider.id, key, shared), [keys.providers]).then((exit) => { const failure = exitFailure(exit); if (failure === undefined) { onDone('Account added.'); setKey(''); setOpen(false) } else setError(failure) })}>Add</button>
      </span>
    )
  }
  if (flow === undefined) {
    return (
      <span className="form">
        {sharedBox}
        <button type="button" className="button button-primary" onClick={() => void command((api) => api.startOAuth(provider.id), []).then((exit) => { if (Exit.isSuccess(exit)) setFlow(exit.value); else setError(exitFailure(exit)) })}>Sign in</button>
        {error === undefined ? null : <span className="muted">{error}</span>}
      </span>
    )
  }
  if (provider.id === 'openai') {
    return (
      <span className="form">
        <span>Open <a href={flow.url} target="_blank" rel="noreferrer">{flow.url}</a> and enter <b>{flow.userCode}</b>. This page notices when you are done.</span>
        {error === undefined ? null : <span className="muted">{error}</span>}
      </span>
    )
  }
  return (
    <span className="form">
      <span><a href={flow.url} target="_blank" rel="noreferrer">Sign in to Claude</a>. You will land on a page that does not load: copy its whole address and paste it here.</span>
      <input value={pasted} placeholder="http://localhost:53692/callback?code=…" onChange={(event) => setPasted(event.target.value)} />
      {error === undefined ? null : <span className="muted">{error}</span>}
      <button type="button" className="button button-primary" onClick={() => void command((api) => api.finishOAuth('anthropic', shared, pasted), [keys.providers]).then((exit) => { const failure = exitFailure(exit); if (failure === undefined) { onDone('Claude account added.'); setOpen(false); setFlow(undefined); setPasted('') } else setError(failure) })}>Finish</button>
    </span>
  )
}

function MemberFiles() {
  return (
    <>
      <h2>What your Robots know about you</h2>
      <div className="muted">Every Robot of yours reads these files. Mr. Robot keeps them current; your other Robots propose edits for you to approve. A Robot is told when one changes.</div>
      <MemberFile name="USER.md" />
      <MemberFile name="memory/world.md" />
      <MemberFile name="PROACTIVE_PREFERENCES.md" />
    </>
  )
}

function MemberFile({ name }: { name: string }) {
  return <AtomView atom={memberFileAtom(name)}>{(file) => <MemberFileEditor name={name} initial={file.content} />}</AtomView>
}

function MemberFileEditor({ name, initial }: { name: string; initial: string }) {
  const command = useCommand()
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState<string>()
  return (
    <label>{name}
      <textarea rows={8} value={content} placeholder={PLACEHOLDERS[name]} onChange={(event) => { setContent(event.target.value); setSaved(undefined) }} onBlur={() => void command((api) => api.writeMemberFile(name, content), [keys.memberFiles]).then((exit) => setSaved(exitFailure(exit) ?? 'Saved.'))} />
      {saved === undefined ? null : <span className="muted">{saved}</span>}
    </label>
  )
}
/** Web Push on this device (robot-ajrp, robot-9xoj). On a phone, install the app first. */
function DeviceNotifications({ vapidPublicKey }: { vapidPublicKey: string }) {
  // In the desktop app notifications arrive over its own connection, natively (pl-b5vp).
  if (hostBridge()?.nativeNotifications === true) {
    return (
      <div className="toggle-card"><div><div>Notifications on this computer</div><div className="muted">The Mr. Robot app shows them as system notifications while this computer is paired. Quiet hours hold them until morning.</div></div></div>
    )
  }
  return <WebPushSwitch vapidPublicKey={vapidPublicKey} />
}

function WebPushSwitch({ vapidPublicKey }: { vapidPublicKey: string }) {
  const command = useCommand()
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!supported) return
    void navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then(setSubscription)
  }, [supported])
  if (!supported) return <><h2>Notifications</h2><div className="muted">This browser cannot receive push notifications. On a phone, add Mr. Robot to the home screen first.</div></>
  const enable = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications are blocked for this site')
      const registration = await navigator.serviceWorker.ready
      const created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(vapidPublicKey) })
      const failure = exitFailure(await command((api) => api.subscribePush(created.toJSON(), navigator.userAgent.slice(0, 80)), []))
      if (failure !== undefined) throw new Error(failure)
      setSubscription(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'cannot enable notifications')
    }
  }
  const disable = async () => {
    if (subscription === null) return
    await command((api) => api.unsubscribePush(subscription.endpoint), [])
    await subscription.unsubscribe()
    setSubscription(null)
  }
  return (
    <>
      <h2>Notifications</h2>
      <div className="toggle-card">
        <div>
          <div>Notifications on this device</div>
          <div className="muted">Robots tell you when they finish, need you, or are blocked. Quiet hours hold them until morning.</div>
        </div>
        <button type="button" role="switch" aria-checked={subscription !== null} aria-label="Notifications on this device" className={subscription !== null ? 'switch on' : 'switch'} onClick={() => void (subscription === null ? enable() : disable())}><span /></button>
      </div>
      {error === undefined ? null : <div className="muted">{error}</div>}
    </>
  )
}

function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
/** The vault (robot-vplt): values go in, never come back out to the browser. */
/** Logins (v1.1 ticket 05, rb-4dxe): entries with username, password, websites and notes; granted per Robot. */
function Secrets() {
  const listResult = useAtomValue(secretsAtom)
  const list = listResult._tag === 'Success' ? listResult.value : undefined
  const command = useCommand()
  const [editing, setEditing] = useState<LoginDraft | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const run = async (action: Parameters<typeof command>[0]) => {
    const failure = exitFailure(await command(action, [keys.secrets]))
    setError(failure)
    return failure === undefined
  }
  const save = async (draft: LoginDraft) => {
    const ok = await run((api) => api.putLogin(draft.name, {
      username: draft.username,
      ...(draft.password === '' ? {} : { password: draft.password }),
      websites: draft.websites.split(/[\n,]/).map((site) => site.trim()).filter((site) => site !== ''),
      notes: draft.notes,
      allowRead: draft.allowRead,
      shared: draft.shared,
    }))
    if (ok) setEditing(null)
  }
  return (
    <>
      <h2>Logins</h2>
      <div className="muted">Accounts your Robots may use once you grant them in a Robot's Advanced settings. A Robot fills the username and password into the matching website without seeing the password; "allow reading" lets it read the value (for API keys).</div>
      <div className="login-list">
        {(list ?? []).map((login) => (
          <div key={`${login.scope}-${login.name}`} className="login-row">
            <div className="login-main">
              <strong>{login.name}</strong>
              <span className="muted">{[login.username, login.websites.join(', ')].filter((part) => part !== '').join(' · ') || 'no username or website yet'}</span>
              <span className="muted">{login.scope === 'home' ? 'Shared with the Home' : 'Private'}{login.allowRead ? ' · allow reading' : ''}{login.robots.length === 0 ? '' : ` · granted to ${login.robots.join(', ')}`}</span>
              {revealed[login.name] === undefined ? null : <code className="login-revealed">{revealed[login.name]}</code>}
            </div>
            {login.mine ? (
              <span className="form inline">
                <button type="button" className="link" onClick={() => revealed[login.name] === undefined
                  ? void command((api) => api.revealLogin(login.name), []).then((exit) => { if (Exit.isSuccess(exit)) setRevealed({ ...revealed, [login.name]: exit.value.password }); else setError(exitFailure(exit)) })
                  : setRevealed(Object.fromEntries(Object.entries(revealed).filter(([name]) => name !== login.name)))}>{revealed[login.name] === undefined ? 'Reveal' : 'Hide'}</button>
                <button type="button" className="link" onClick={() => setEditing({ name: login.name, username: login.username, password: '', websites: login.websites.join('\n'), notes: login.notes, allowRead: login.allowRead, shared: login.scope === 'home', existing: true })}>Edit</button>
                <button type="button" className="link" onClick={() => void run((api) => api.deleteSecret(login.name))}>Delete</button>
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {editing === null
        ? <button type="button" className="button" onClick={() => setEditing({ name: '', username: '', password: '', websites: '', notes: '', allowRead: false, shared: false, existing: false })}>Add login</button>
        : <LoginForm draft={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />}
      {error === undefined ? null : <div className="muted">{error}</div>}
    </>
  )
}

interface LoginDraft {
  readonly name: string
  readonly username: string
  readonly password: string
  readonly websites: string
  readonly notes: string
  readonly allowRead: boolean
  readonly shared: boolean
  readonly existing: boolean
}

function LoginForm({ draft, onChange, onSave, onCancel }: { draft: LoginDraft; onChange: (draft: LoginDraft) => void; onSave: (draft: LoginDraft) => Promise<void>; onCancel: () => void }) {
  return (
    <div className="form login-form">
      <label>Name<input value={draft.name} disabled={draft.existing} placeholder="e.g. allegro" onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
      <label>Username<input value={draft.username} autoComplete="off" onChange={(event) => onChange({ ...draft, username: event.target.value })} /></label>
      <label>Password<input type="password" value={draft.password} autoComplete="new-password" placeholder={draft.existing ? 'unchanged' : ''} onChange={(event) => onChange({ ...draft, password: event.target.value })} /></label>
      <label>Websites<textarea rows={2} value={draft.websites} placeholder="https://allegro.pl (one per line)" onChange={(event) => onChange({ ...draft, websites: event.target.value })} /></label>
      <label>Notes<textarea rows={2} value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={draft.allowRead} onChange={(event) => onChange({ ...draft, allowRead: event.target.checked })} /><span>Allow reading<small>The Robot may read the value itself (API keys). Leave off for website passwords.</small></span></label>
      <label className="check"><input type="checkbox" checked={draft.shared} onChange={(event) => onChange({ ...draft, shared: event.target.checked })} /><span>Share with the Home<small>Other Members can grant it to their Robots.</small></span></label>
      <div className="question-actions">
        <button type="button" className="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="button button-primary" disabled={draft.name === '' || (!draft.existing && draft.password === '')} onClick={() => void onSave(draft)}>Save</button>
      </div>
    </div>
  )
}

const THEMES = [{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }] as const

/** Theme (ap-itj1): follow the system or pin light or dark; per person, applied at once. */
function ThemeSetting({ me }: { me: Me }) {
  const command = useCommand()
  const [value, setValue] = useState<ThemeChoice>(me.theme ?? 'system')
  return (
    <>
      <h2>Theme</h2>
      <div className="muted">System follows your device's light or dark setting.</div>
      <div className="segmented" role="radiogroup" aria-label="Theme">
        {THEMES.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? 'segment active' : 'segment'}
            onClick={() => { setValue(option.id); applyTheme(option.id); void command((api) => api.updateMe({ theme: option.id }), [keys.me]) }}>{option.label}</button>
        ))}
      </div>
    </>
  )
}

/** Work details (pl-6eir): how much of a Robot's work the chat shows; per person. */
function WorkDetailsSetting({ me }: { me: Me }) {
  const command = useCommand()
  const [value, setValue] = useState(me.workDetails ?? 'compact')
  return (
    <>
      <h2>Work details</h2>
      <div className="muted">How much of a Robot's work you see in a conversation. The trajectory stays available as the full debug view.</div>
      <div className="segmented" role="radiogroup" aria-label="Work details">
        {WORK_DETAILS.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? 'segment active' : 'segment'}
            onClick={() => { setValue(option.id); void command((api) => api.updateMe({ workDetails: option.id }), [keys.me]) }}>{option.label}</button>
        ))}
      </div>
      <div className="muted">{WORK_DETAILS.find((option) => option.id === value)?.note}</div>
    </>
  )
}

/** Reset everything (pl-062x): as if signing in for the first time, without entering credentials again. */
function ResetEverything({ me }: { me: Me }) {
  const command = useCommand()
  const [open, setOpen] = useState(false)
  return (
    <>
      <h2>Reset everything</h2>
      <div className="muted">Deletes all your robots, their conversations, files and memory, your memory files and usage, and starts a fresh Mr. Robot. Your logins, providers, computers, the Home's members and its skill library stay.</div>
      <div><button type="button" className="button button-danger" onClick={() => setOpen(true)}>Reset everything…</button></div>
      {open ? (
        <ConfirmByName
          title="Reset everything"
          name={me.name}
          goes="All your robots, conversations, robot files, memory files and usage are deleted. A fresh Mr. Robot starts."
          stays="Logins, providers, computers, members and the skill library stay."
          action="Reset everything"
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            const exit = await command((api) => api.resetEverything(me.name), [])
            if (Exit.isSuccess(exit)) { location.hash = '#/'; location.reload() }
            return exit
          }}
        />
      ) : null}
    </>
  )
}

const PLACEHOLDERS: Record<string, string> = {
  'memory/world.md': 'Facts every Robot of yours may need: your address, company and tax details, accounts, how invoices are issued, recurring bills.',
}
