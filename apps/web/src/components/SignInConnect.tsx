import { useState, type ReactNode } from 'react'
import * as Exit from 'effect/Exit'
import type { ConnectorWay, PluginView, SessionCapture } from '@mr-robot/protocol'
import { keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { Takeover } from './Takeover.tsx'
import { hostBridge } from './ThisComputer.tsx'

/**
 * Connecting an account by signing in to the service instead of pasting copied values (v1.12
 * tickets 10 and 11, ux-taxm, ux-66a4, ux-8pek): the desktop app opens a sign-in window, reads the
 * session and hands the values back, and this page posts them to the paste endpoint; in the PWA
 * Mr. Robot's browser opens on the sign-in page under a Takeover and the server reads and connects
 * the session itself. Values are held in one function and are never rendered or logged.
 */

/** How a sign-in ended. 'values' are the fields of the way's paste form, ready to post; 'connected' means the server connected it already. */
export type SignInOutcome =
  | { readonly kind: 'values'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'connected'; readonly account: string }
  | { readonly kind: 'timedOut' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

/** One way to sign in for a connector way, e.g. "Sign in to Slack" in a window of the desktop app. */
export interface SignInWay {
  readonly title: string
  /** What happens when the person presses the button. */
  readonly intro: string
  /** What to tell the person while the way runs, and when it ends without a session. */
  readonly messages: { readonly waiting: string; readonly timedOut: string; readonly cancelled: string }
  /** Opens the way (a window, a Takeover) and resolves when the person is done. */
  readonly start: () => Promise<SignInOutcome>
  /** What the way shows on this page while it runs (the Takeover screen); null for a window of its own. */
  readonly view: ReactNode
}

/** The connector kinds with a sign-in: a window in the desktop app, a Takeover in the PWA. */
const SIGN_IN_KINDS: ReadonlySet<string> = new Set(['slack', 'discord-user'])

/** The answer of the desktop app's command, checked at the boundary. */
export function parseSignIn(raw: unknown): SignInOutcome {
  const answer = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  if (typeof answer.values === 'object' && answer.values !== null) {
    const entries = Object.entries(answer.values).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return { kind: 'values', values: Object.fromEntries(entries) }
  }
  if (answer.timedOut === true) return { kind: 'timedOut' }
  if (answer.cancelled === true) return { kind: 'cancelled' }
  return { kind: 'failed', message: typeof answer.error === 'string' ? answer.error : 'The desktop app gave no answer.' }
}

/** How the server's attempt ended, as the panel tells it. */
function captureOutcome(capture: SessionCapture): SignInOutcome {
  switch (capture.state) {
    case 'connected': return { kind: 'connected', account: capture.account }
    case 'timedOut': return { kind: 'timedOut' }
    case 'failed': return { kind: 'failed', message: `${capture.message.charAt(0).toUpperCase()}${capture.message.slice(1)}.` }
    case 'waiting': case 'none': return { kind: 'cancelled' }
  }
}

/** How often the open Takeover asks whether the server ended the attempt (the ten minutes, ux-wgok). */
const CAPTURE_POLL_MS = 3000

/**
 * The PWA's way (ux-8pek): Mr. Robot's browser opens on the sign-in page and its Takeover shows here.
 * When the person hands back or closes it, the server reads the session and connects it; when the
 * server ends the attempt first (ten minutes), the Takeover closes by itself.
 */
function useTakeoverSignIn(plugin: PluginView, way: ConnectorWay): SignInWay {
  const command = useCommand()
  const [open, setOpen] = useState<{ readonly robotId: string; readonly robotName: string; readonly close: () => void }>()
  const start = async (): Promise<SignInOutcome> => {
    const started = await command((api) => api.startSessionCapture(way.kind), [])
    if (!Exit.isSuccess(started)) return { kind: 'failed', message: `${exitFailure(started) ?? 'the browser did not open'}.` }
    let closed = false
    const viewClosed = new Promise<void>((resolve) => setOpen({ ...started.value, close: () => { closed = true; resolve() } }))
    const serverEnded = (async () => {
      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_POLL_MS))
        if (closed) return
        const exit = await command((api) => api.sessionCapture(way.kind), [])
        if (Exit.isSuccess(exit) && exit.value.state !== 'waiting') return
      }
    })()
    await Promise.race([viewClosed, serverEnded])
    closed = true
    setOpen(undefined)
    const ended = await command((api) => api.endSessionCapture(way.kind), [keys.connections])
    return Exit.isSuccess(ended) ? captureOutcome(ended.value) : { kind: 'failed', message: `${exitFailure(ended) ?? 'the sign-in did not end'}.` }
  }
  return {
    title: "Sign in through your Robot's browser",
    intro: `Mr. Robot's browser opens on the ${plugin.title} sign-in page. Take it over, sign in with your own account and hand it back; Mr. Robot connects it and removes the session from its browser. Nothing is shown to you or to a Robot.`,
    messages: {
      waiting: `Mr. Robot's browser is open on the ${plugin.title} sign-in page. Take it over, sign in, then hand it back.`,
      timedOut: 'No one signed in within 10 minutes, so the sign-in ended. Nothing was connected. Try again, or paste a session instead.',
      cancelled: 'The sign-in was closed. Nothing was connected.',
    },
    start,
    view: open === undefined ? null : (
      <Takeover
        robotId={open.robotId}
        robotName={open.robotName}
        requested={{ reason: `Sign in to ${plugin.title}` }}
        note={`Sign in with your own account, then hand the browser back: ${open.robotName} connects it and removes the session from its browser.`}
        onClose={open.close}
      />
    ),
  }
}

/**
 * The ways to sign in for a connector way (undefined: only the paste form): the desktop app's
 * window when its bridge offers one, otherwise (the PWA) the Takeover of Mr. Robot's browser.
 */
export function useSignInWay(plugin: PluginView, way: ConnectorWay): SignInWay | undefined {
  const takeover = useTakeoverSignIn(plugin, way)
  if (!way.actsAsPerson || !SIGN_IN_KINDS.has(way.kind)) return undefined
  const bridge = hostBridge()
  if (bridge === undefined) return takeover
  const connect = bridge.connectThroughSignIn
  // An older desktop app without the command: only the paste form.
  if (connect === undefined) return undefined
  return {
    title: `Sign in to ${plugin.title}`,
    intro: 'A window opens on the sign-in page. Sign in there with your own account; Mr. Robot connects it for you and closes the window. Nothing is shown to you or to a Robot.',
    messages: {
      waiting: 'The sign-in window is open. Sign in there; this page connects as soon as you are signed in.',
      timedOut: 'No one signed in within 10 minutes, so the window was closed. Nothing was connected. Try again, or paste a session instead.',
      cancelled: 'The sign-in window was closed. Nothing was connected.',
    },
    start: async () => {
      try {
        return parseSignIn(await connect.call(bridge, way.kind))
      } catch {
        return { kind: 'failed', message: 'The desktop app did not answer.' }
      }
    },
    view: null,
  }
}

/** A sign-in attempt of one way: run it, and what to tell the person while and after. */
export function useSignInAttempt(way: ConnectorWay, signIn: SignInWay | undefined) {
  const command = useCommand()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const attempt = async (ways: SignInWay): Promise<string> => {
    const outcome = await ways.start()
    if (outcome.kind === 'timedOut' || outcome.kind === 'cancelled') return ways.messages[outcome.kind]
    if (outcome.kind === 'failed') return `Signing in failed: ${outcome.message} You can paste a session instead.`
    if (outcome.kind === 'connected') return `Connected ${outcome.account}.`
    // The same fields and the same request as the paste form.
    const fields = way.connect.method === 'paste' ? way.connect.fields : []
    const values = Object.fromEntries(fields.flatMap((field) => { const value = outcome.values[field.key]; return value === undefined || value === '' ? [] : [[field.key, value] as const] }))
    if (fields.some((field) => field.required && values[field.key] === undefined)) return 'Signing in did not give everything this connection needs. You can paste a session instead.'
    const exit = await command((api) => api.pasteConnection(way.kind, { shared: false, values }), [keys.connections])
    return Exit.isSuccess(exit) ? `Connected ${exit.value.account}.` : `Signing in worked, but connecting failed: ${exitFailure(exit)}`
  }
  const run = async (): Promise<void> => {
    if (signIn === undefined || busy) return
    setBusy(true)
    setMessage(signIn.messages.waiting)
    setMessage(await attempt(signIn))
    setBusy(false)
  }
  return { busy, message, run: () => void run() }
}

/** The primary way of a sign-in-capable way, with the paste form folded under "Paste a session instead". */
export function SignInConnect({ way, signIn, attempt, children }: { way: ConnectorWay; signIn: SignInWay; attempt: ReturnType<typeof useSignInAttempt>; children: ReactNode }) {
  const warning = way.connect.method === 'paste' ? way.connect.warning : undefined
  return (
    <>
      <div className="form connect-form">
        <div className="muted">{signIn.intro}</div>
        {warning === undefined ? null : <div className="note">{warning}</div>}
        <div className="question-actions">
          {attempt.message === undefined ? null : <span className="muted" role="status">{attempt.message}</span>}
          <button type="button" className="button button-primary" disabled={attempt.busy} onClick={attempt.run}>{signIn.title}</button>
        </div>
      </div>
      {signIn.view}
      <details className="paste-fallback">
        <summary>Paste a session instead</summary>
        {children}
      </details>
    </>
  )
}
