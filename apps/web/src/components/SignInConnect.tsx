import { useState, type ReactNode } from 'react'
import * as Exit from 'effect/Exit'
import type { ConnectorWay, PluginView } from '@mr-robot/protocol'
import { keys, useCommand } from '../client/api-atoms.ts'
import { exitFailure } from '../client/api-failure.ts'
import { hostBridge } from './ThisComputer.tsx'

/**
 * Connecting an account by signing in to the service instead of pasting copied values (v1.12
 * ticket 10, ux-taxm, ux-66a4): the desktop app opens a sign-in window, reads the session and hands
 * the values back; this page posts them to the paste endpoint. The values are held in one function
 * and are never rendered or logged.
 */

/** How a sign-in ended. 'values' are the fields of the way's paste form, ready to post. */
export type SignInOutcome =
  | { readonly kind: 'values'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'timedOut' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

/** One way to sign in for a connector way, e.g. "Sign in to Slack" in a window of the desktop app. */
export interface SignInWay {
  readonly title: string
  /** Opens the way (a window, a Takeover) and resolves when the person is done. */
  readonly start: () => Promise<SignInOutcome>
}

/** The connector kinds the desktop app opens a window for. */
const DESKTOP_KINDS: ReadonlySet<string> = new Set(['slack', 'discord-user'])

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

/**
 * The ways to sign in for a connector way (undefined: only the paste form). Today the desktop
 * app's bridge is the only way; ticket 11 adds the Takeover way for the PWA here, returning its own
 * SignInWay when there is no bridge, and the panel needs no other change.
 */
export function useSignInWay(plugin: PluginView, way: ConnectorWay): SignInWay | undefined {
  const bridge = hostBridge()
  const connect = bridge?.connectThroughSignIn
  if (bridge === undefined || connect === undefined || !way.actsAsPerson || !DESKTOP_KINDS.has(way.kind)) return undefined
  return {
    title: `Sign in to ${plugin.title}`,
    start: async () => {
      try {
        return parseSignIn(await connect.call(bridge, way.kind))
      } catch {
        return { kind: 'failed', message: 'The desktop app did not answer.' }
      }
    },
  }
}

const WAIT = 'The sign-in window is open. Sign in there; this page connects as soon as you are signed in.'
const MESSAGES = {
  timedOut: 'No one signed in within 10 minutes, so the window was closed. Nothing was connected. Try again, or paste a session instead.',
  cancelled: 'The sign-in window was closed. Nothing was connected.',
} as const

/** A sign-in attempt of one way: run it, and what to tell the person while and after. */
export function useSignInAttempt(way: ConnectorWay, signIn: SignInWay | undefined) {
  const command = useCommand()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const attempt = async (): Promise<string> => {
    if (signIn === undefined) return ''
    const outcome = await signIn.start()
    if (outcome.kind === 'timedOut' || outcome.kind === 'cancelled') return MESSAGES[outcome.kind]
    if (outcome.kind === 'failed') return `Signing in failed: ${outcome.message} You can paste a session instead.`
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
    setMessage(WAIT)
    setMessage(await attempt())
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
        <div className="muted">A window opens on the sign-in page. Sign in there with your own account; Mr. Robot connects it for you and closes the window. Nothing is shown to you or to a Robot.</div>
        {warning === undefined ? null : <div className="note">{warning}</div>}
        <div className="question-actions">
          {attempt.message === undefined ? null : <span className="muted" role="status">{attempt.message}</span>}
          <button type="button" className="button button-primary" disabled={attempt.busy} onClick={attempt.run}>{signIn.title}</button>
        </div>
      </div>
      <details className="paste-fallback">
        <summary>Paste a session instead</summary>
        {children}
      </details>
    </>
  )
}
