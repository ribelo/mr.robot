import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { HomeSpendLimit, RobotSpendLimit } from '@mr-robot/protocol'

type SpendLimitKind = RobotSpendLimit['kind']

/** A limit as the form holds it: the chosen kind and the amount as typed, kept while another kind is chosen. */
export interface SpendLimitDraft {
  readonly kind: SpendLimitKind
  readonly amount: string
}

export const spendLimitDraft = (limit: RobotSpendLimit): SpendLimitDraft => ({ kind: limit.kind, amount: limit.kind === 'usd' ? String(limit.amount) : '' })

const candidate = (draft: SpendLimitDraft) => (draft.kind === 'usd' ? { kind: 'usd', amount: draft.amount.trim() === '' ? Number.NaN : Number(draft.amount) } : { kind: draft.kind })

/** The Home's limit the draft says; none when the amount is not whole dollars of at least 1. */
export const parseHomeSpendLimit = (draft: SpendLimitDraft): Option.Option<HomeSpendLimit> => Schema.decodeUnknownOption(HomeSpendLimit)(candidate(draft))

/** A Robot's limit the draft says; none when the amount is not whole dollars of at least 1. */
export const parseRobotSpendLimit = (draft: SpendLimitDraft): Option.Option<RobotSpendLimit> => Schema.decodeUnknownOption(RobotSpendLimit)(candidate(draft))

const KIND_LABELS: Record<SpendLimitKind, string> = { home: "Home's", none: 'No limit', usd: 'Amount' }

/**
 * A monthly spend limit (ux-dbx4, ux-q8ve): a segmented choice between the kinds offered, and an amount
 * field only for An amount. `note` is a line under the control, e.g. the limit in effect.
 */
export function SpendLimitChoice({ label, kinds, draft, valid, note, onChange }: {
  readonly label: string
  readonly kinds: readonly SpendLimitKind[]
  readonly draft: SpendLimitDraft
  /** The draft parses; false shows what the amount must be. */
  readonly valid: boolean
  readonly note?: string
  readonly onChange: (draft: SpendLimitDraft) => void
}) {
  return (
    <div className="spend-limit">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {kinds.map((kind) => (
          <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className={draft.kind === kind ? 'segment active' : 'segment'} onClick={() => onChange({ ...draft, kind })}>{KIND_LABELS[kind]}</button>
        ))}
      </div>
      {draft.kind === 'usd' ? (
        <label>USD per month
          <input type="number" min={1} step={1} aria-label={`${label}, USD per month`} value={draft.amount} onChange={(event) => onChange({ ...draft, amount: event.target.value })} />
        </label>
      ) : null}
      {valid ? (note === undefined ? null : <small className="muted">{note}</small>) : <small className="muted">The amount is whole dollars, at least 1.</small>}
    </div>
  )
}
