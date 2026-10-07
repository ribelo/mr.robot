import { WORK_DETAILS } from './WorkDetails.tsx'
import { Hosts } from './Hosts.tsx'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Me, ProvidersView, LoginView } from '@mr-robot/protocol'
import { api, ApiError } from '../api.ts'

const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', note: 'DeepSeek models with your API key.', kind: 'api-key' },
  { id: 'openrouter', name: 'OpenRouter', note: 'Hundreds of models with one API key.', kind: 'api-key' },
  { id: 'openai', name: 'ChatGPT', note: 'Your ChatGPT plan, signed in with OpenAI.', kind: 'oauth' },
  { id: 'anthropic', name: 'Claude', note: 'Your Claude plan, signed in with Anthropic.', kind: 'oauth' },
] as const

/** A Member's own settings: profile, quiet hours, Provider credentials, Member files. */
export function Profile({ me, onChanged }: { me: Me; onChanged: () => void }) {
  return (
    <div className="form">
      <Preferences me={me} onChanged={onChanged} />
      <WorkDetailsSetting me={me} onChanged={onChanged} />
      <DeviceNotifications vapidPublicKey={me.vapidPublicKey} />
      <Providers />
      <Secrets />
      <Hosts />
      <MemberFiles />
    </div>
  )
}

function Preferences({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [name, setName] = useState(me.name)
  const [timeZone, setTimeZone] = useState(me.timeZone)
  const [quiet, setQuiet] = useState(me.quietHours ?? { start: '', end: '' })
  const [saved, setSaved] = useState(false)
  const save = async () => {
    await api.updateMe({ name, timeZone, quietHours: quiet.start !== '' && quiet.end !== '' ? quiet : null })
    setSaved(true)
    onChanged()
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
      <div className="question-actions">{saved ? <span className="muted">Saved.</span> : null}<button type="button" className="button button-primary" onClick={() => void save()}>Save</button></div>
    </>
  )
}

function Providers() {
  const [view, setView] = useState<ProvidersView>()
  const [message, setMessage] = useState<string>()
  const refresh = useCallback(() => api.providers().then(setView), [])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action()
      setMessage(done)
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'failed')
    }
    await refresh()
  }
  if (view === undefined) return <div className="muted">Loading Providers…</div>
  const sharedBy = (id: string) => view.shared.filter((entry) => entry.provider === id).map((entry) => entry.ownerName)
  const shareToggle = (id: string) => {
    const mine = view.mine.find((entry) => entry.provider === id)
    return mine === undefined ? null : <label className="check"><input type="checkbox" checked={mine.shared} onChange={(event) => void run(() => api.shareProvider(id, event.target.checked))} /> shared with the Home</label>
  }
  return (
    <>
      <h2>Providers</h2>
      <div className="muted">Your keys and subscriptions run your Robots. Share one with the Home and every Member's Robots can use it.</div>
      {message === undefined ? null : <div className="muted">{message}</div>}
      <div className="providers">
        {PROVIDERS.map((provider) => {
          const mine = view.mine.find((entry) => entry.provider === provider.id)
          return (
            <ProviderRow key={provider.id} name={provider.name} note={provider.note} sharedBy={sharedBy(provider.id)}>
              {mine === undefined
                ? <Connect provider={provider} onDone={(text) => void run(async () => undefined, text)} />
                : (
                  <span className="form inline">
                    <span className="connected">Connected</span>
                    {shareToggle(provider.id)}
                    <button type="button" className="link" onClick={() => void run(() => api.removeProvider(provider.id), 'Removed.')}>Remove</button>
                  </span>
                )}
            </ProviderRow>
          )
        })}
        <ProviderRow name="OpenCode Go" note="Every model of the plan. With several keys, the next one takes over when a key runs out." sharedBy={sharedBy('opencode-go')}>
          <OpencodeKeys share={shareToggle('opencode-go')} onChanged={refresh} />
        </ProviderRow>
        <ProviderRow name="Workers AI" note="Models on Cloudflare, billed to this Cloudflare account." sharedBy={[]}>
          <span className="muted">Included</span>
        </ProviderRow>
      </div>
    </>
  )
}

function ProviderRow({ name, note, sharedBy, children }: { name: string; note: string; sharedBy: string[]; children: ReactNode }) {
  return (
    <div className="provider">
      <div className="provider-name">
        <div>{name}</div>
        <div className="muted">{note}{sharedBy.length > 0 ? ` Shared with the Home by ${sharedBy.join(', ')}.` : ''}</div>
      </div>
      <div className="provider-action">{children}</div>
    </div>
  )
}

/** OpenCode Go keys (ticket 19): a pool, so it is managed here rather than through Connect. */
function OpencodeKeys({ share, onChanged }: { share: ReactNode; onChanged: () => Promise<unknown> }) {
  const [view, setView] = useState<Awaited<ReturnType<typeof api.opencodeKeys>>>()
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => { void api.opencodeKeys().then(setView) }, [])
  const change = async (action: () => Promise<Awaited<ReturnType<typeof api.opencodeKeys>>>) => {
    try {
      setView(await action())
      setError(undefined)
      await onChanged()
      return true
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'failed')
      return false
    }
  }
  const keys = view?.keys ?? []
  const form = (
    <span className="form inline">
      <input type="password" value={key} placeholder="OpenCode API key (sk-…)" onChange={(event) => setKey(event.target.value)} />
      <button type="button" className="button" disabled={key.trim() === ''} onClick={() => void change(() => api.addOpencodeKey(key)).then((ok) => { if (ok) { setKey(''); setAdding(false) } })}>Add</button>
    </span>
  )
  if (keys.length === 0) {
    return (
      <span className="form">
        {adding ? form : <button type="button" className="button" onClick={() => setAdding(true)}>Connect</button>}
        {error === undefined ? null : <span className="muted">{error}</span>}
      </span>
    )
  }
  return (
    <span className="form">
      <span className="form inline"><span className="connected">Connected</span>{share}</span>
      {keys.map((entry) => (
        <span key={entry.id} className="form inline key-row">
          <span className="mono">{entry.masked}</span>
          {entry.id === view?.activeId ? <span className="muted">in use</span> : <button type="button" className="link" onClick={() => void change(() => api.activateOpencodeKey(entry.id))}>Use this one</button>}
          <button type="button" className="link" onClick={() => void change(() => api.removeOpencodeKey(entry.id))}>Remove</button>
        </span>
      ))}
      {adding ? form : <button type="button" className="link" onClick={() => setAdding(true)}>+ Add another key</button>}
      {error === undefined ? null : <span className="muted">{error}</span>}
    </span>
  )
}

function Connect({ provider, onDone }: { provider: (typeof PROVIDERS)[number]; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [shared, setShared] = useState(false)
  const [flow, setFlow] = useState<{ url: string; userCode?: string }>()
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (provider.id !== 'openai' || flow === undefined) return
    const timer = setInterval(() => {
      api.finishOAuth('openai', shared).then((result) => {
        if (result.connected) {
          clearInterval(timer)
          onDone('ChatGPT subscription connected.')
        }
      }, (cause: unknown) => {
        clearInterval(timer)
        setError(cause instanceof ApiError ? cause.message : 'sign-in failed')
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [flow, provider.id, shared, onDone])

  if (!open) return <button type="button" className="button" onClick={() => setOpen(true)}>Connect</button>
  const sharedBox = <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> share with the Home</label>
  if (provider.kind === 'api-key') {
    return (
      <span className="form">
        <input type="password" value={key} placeholder="API key" onChange={(event) => setKey(event.target.value)} />
        {sharedBox}
        {error === undefined ? null : <span className="muted">{error}</span>}
        <button type="button" className="button button-primary" onClick={() => void api.setApiKey(provider.id, key, shared).then(() => onDone('Saved.'), (cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'failed'))}>Save</button>
      </span>
    )
  }
  if (flow === undefined) {
    return (
      <span className="form">
        {sharedBox}
        <button type="button" className="button button-primary" onClick={() => void api.startOAuth(provider.id).then(setFlow, (cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'failed'))}>Sign in</button>
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
      <button type="button" className="button button-primary" onClick={() => void api.finishOAuth('anthropic', shared, pasted).then(() => onDone('Claude subscription connected.'), (cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'failed'))}>Finish</button>
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
  const [content, setContent] = useState<string>()
  const [saved, setSaved] = useState(false)
  useEffect(() => { void api.memberFile(name).then((file) => setContent(file.content)) }, [name])
  if (content === undefined) return null
  return (
    <label>{name}
      <textarea rows={8} value={content} onChange={(event) => { setContent(event.target.value); setSaved(false) }} onBlur={() => void api.writeMemberFile(name, content).then(() => setSaved(true))} />
      {saved ? <span className="muted">Saved.</span> : null}
    </label>
  )
}
/** Web Push on this device (robot-ajrp, robot-9xoj). On a phone, install the app first. */
function DeviceNotifications({ vapidPublicKey }: { vapidPublicKey: string }) {
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
      await api.subscribePush(created.toJSON(), navigator.userAgent.slice(0, 80))
      setSubscription(created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'cannot enable notifications')
    }
  }
  const disable = async () => {
    if (subscription === null) return
    await api.unsubscribePush(subscription.endpoint)
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
  const [list, setList] = useState<LoginView[]>()
  const [editing, setEditing] = useState<LoginDraft | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const refresh = useCallback(() => api.secrets().then(setList), [])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(undefined)
      return true
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'failed')
      return false
    } finally {
      await refresh()
    }
  }
  const save = async (draft: LoginDraft) => {
    const ok = await run(() => api.putLogin(draft.name, {
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
                  ? void api.revealLogin(login.name).then(({ password }) => setRevealed({ ...revealed, [login.name]: password }))
                  : setRevealed(Object.fromEntries(Object.entries(revealed).filter(([name]) => name !== login.name)))}>{revealed[login.name] === undefined ? 'Reveal' : 'Hide'}</button>
                <button type="button" className="link" onClick={() => setEditing({ name: login.name, username: login.username, password: '', websites: login.websites.join('\n'), notes: login.notes, allowRead: login.allowRead, shared: login.scope === 'home', existing: true })}>Edit</button>
                <button type="button" className="link" onClick={() => void run(() => api.deleteSecret(login.name))}>Delete</button>
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

/** Work details (pl-6eir): how much of a Robot's work the chat shows; per person. */
function WorkDetailsSetting({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [value, setValue] = useState(me.workDetails ?? 'compact')
  return (
    <>
      <h2>Work details</h2>
      <div className="muted">How much of a Robot's work you see in a conversation. The trajectory stays available as the full debug view.</div>
      <div className="segmented" role="radiogroup" aria-label="Work details">
        {WORK_DETAILS.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? 'segment active' : 'segment'}
            onClick={() => { setValue(option.id); void api.updateMe({ workDetails: option.id }).then(onChanged) }}>{option.label}</button>
        ))}
      </div>
      <div className="muted">{WORK_DETAILS.find((option) => option.id === value)?.note}</div>
    </>
  )
}
