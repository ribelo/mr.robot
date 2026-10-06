import { useCallback, useEffect, useState } from 'react'
import type { Me, ProvidersView } from '@mr-robot/protocol'
import { api, ApiError } from '../api.ts'

const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'api-key' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'api-key' },
  { id: 'openai', name: 'ChatGPT subscription (OpenAI)', kind: 'oauth' },
  { id: 'anthropic', name: 'Claude subscription (Anthropic)', kind: 'oauth' },
] as const

/** A Member's own settings: profile, quiet hours, Provider credentials, Member files. */
export function Profile({ me, onChanged }: { me: Me; onChanged: () => void }) {
  return (
    <div className="form">
      <Preferences me={me} onChanged={onChanged} />
      <DeviceNotifications vapidPublicKey={me.vapidPublicKey} />
      <Providers />
      <Secrets />
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
  return (
    <>
      <h2>Providers</h2>
      <div className="muted">Your keys and subscriptions run your Robots. Share one with the Home and every Member's Robots can use it.</div>
      {message === undefined ? null : <div className="muted">{message}</div>}
      <table className="grid">
        <tbody>
          {PROVIDERS.map((provider) => {
            const mine = view.mine.find((entry) => entry.provider === provider.id)
            const shared = view.shared.filter((entry) => entry.provider === provider.id)
            return (
              <tr key={provider.id}>
                <td>{provider.name}{shared.length > 0 ? <div className="muted">shared by {shared.map((entry) => entry.ownerName).join(', ')}</div> : null}</td>
                <td>
                  {mine === undefined
                    ? <Connect provider={provider} onDone={(text) => void run(async () => undefined, text)} />
                    : (
                      <span className="form inline">
                        <span className="state">connected</span>
                        <label className="check"><input type="checkbox" checked={mine.shared} onChange={(event) => void run(() => api.shareProvider(provider.id, event.target.checked))} /> shared with the Home</label>
                        <button type="button" className="link" onClick={() => void run(() => api.removeProvider(provider.id), 'Removed.')}>Remove</button>
                      </span>
                    )}
                </td>
              </tr>
            )
          })}
          <tr><td>Workers AI</td><td><span className="state">always available</span></td></tr>
        </tbody>
      </table>
      <OpencodeKeys shared={view.mine.find((entry) => entry.provider === 'opencode-go')?.shared ?? false} sharedBy={view.shared.filter((entry) => entry.provider === 'opencode-go').map((entry) => entry.ownerName)} onShare={(on) => run(() => api.shareProvider('opencode-go', on))} onChanged={refresh} />
    </>
  )
}

/** OpenCode Go keys (ticket 19): when one runs out, the next takes over and becomes active. */
function OpencodeKeys({ shared, sharedBy, onShare, onChanged }: { shared: boolean; sharedBy: string[]; onShare: (on: boolean) => Promise<void>; onChanged: () => Promise<unknown> }) {
  const [view, setView] = useState<Awaited<ReturnType<typeof api.opencodeKeys>>>()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => { void api.opencodeKeys().then(setView) }, [])
  const change = async (action: () => Promise<Awaited<ReturnType<typeof api.opencodeKeys>>>) => {
    try {
      setView(await action())
      setError(undefined)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'failed')
    }
  }
  return (
    <>
      <h2>OpenCode Go</h2>
      <div className="muted">Every model of the OpenCode Go plan. Add several keys: when one hits its limit or stops working, your Robots move to the next and it becomes the active one.{sharedBy.length > 0 ? ` Shared with the Home by ${sharedBy.join(', ')}.` : ''}</div>
      <table className="grid">
        <tbody>
          {(view?.keys ?? []).map((entry) => (
            <tr key={entry.id}>
              <td>{entry.masked}</td>
              <td>{entry.id === view?.activeId ? <span className="state">active</span> : <button type="button" className="link" onClick={() => void change(() => api.activateOpencodeKey(entry.id))}>Make active</button>}</td>
              <td><button type="button" className="link" onClick={() => void change(() => api.removeOpencodeKey(entry.id))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form inline">
        <input type="password" value={key} placeholder="OpenCode API key (sk-…)" onChange={(event) => setKey(event.target.value)} />
        <button type="button" className="button" disabled={key.trim() === ''} onClick={() => void change(async () => { const next = await api.addOpencodeKey(key); setKey(''); return next })}>Add key</button>
        {(view?.keys.length ?? 0) > 0 ? <label className="check"><input type="checkbox" checked={shared} onChange={(event) => void onShare(event.target.checked)} /> shared with the Home</label> : null}
      </div>
      {error === undefined ? null : <div className="muted">{error}</div>}
    </>
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
      <div className="muted">Every Robot of yours reads these files and cannot change them; they propose edits for you to approve.</div>
      <MemberFile name="USER.md" />
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
function Secrets() {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.secrets>>>()
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(() => api.secrets().then(setList), [])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'failed')
    }
    await refresh()
  }
  return (
    <>
      <h2>Secrets</h2>
      <div className="muted">Site passwords and codes your Robots may read with secret_get once you grant them. Values are encrypted and never shown again.</div>
      <table className="grid">
        <tbody>
          {(list ?? []).map((secret) => (
            <tr key={`${secret.scope}-${secret.name}`}>
              <td>{secret.name}</td>
              <td>{secret.scope === 'home' ? 'shared with the Home' : 'yours'}</td>
              <td>{secret.mine ? (
                <span className="form inline">
                  <button type="button" className="link" onClick={() => void run(() => api.putSecret(secret.name, secret.scope !== 'home'))}>{secret.scope === 'home' ? 'Make private' : 'Share with the Home'}</button>
                  <button type="button" className="link" onClick={() => void run(() => api.deleteSecret(secret.name))}>Delete</button>
                </span>
              ) : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form inline">
        <input value={name} placeholder="name, e.g. allegro" onChange={(event) => setName(event.target.value)} />
        <input type="password" value={value} placeholder="value" onChange={(event) => setValue(event.target.value)} />
        <label className="check"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> share</label>
        <button type="button" className="button" disabled={name === '' || value === ''} onClick={() => void run(async () => { await api.putSecret(name, shared, value); setName(''); setValue('') })}>Save</button>
      </div>
      {error === undefined ? null : <div className="muted">{error}</div>}
    </>
  )
}
