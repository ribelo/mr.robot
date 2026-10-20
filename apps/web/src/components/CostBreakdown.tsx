import type { CostBreakdown } from '@mr-robot/protocol'

const usd = (amount: number): string => `$${amount.toFixed(2)}`

/** The lines of a month's cost by source (ao-zbld); a model line other than the Robot's own shows only when it cost something. */
export function costLines(breakdown: CostBreakdown): Array<{ label: string; amount: number; sub?: true }> {
  return [
    { label: 'Model', amount: breakdown.model.robot + breakdown.model.review + breakdown.model.subagent },
    ...(breakdown.model.review > 0 || breakdown.model.subagent > 0 ? [{ label: 'Robot', amount: breakdown.model.robot, sub: true as const }] : []),
    ...(breakdown.model.review > 0 ? [{ label: 'Auto review', amount: breakdown.model.review, sub: true as const }] : []),
    ...(breakdown.model.subagent > 0 ? [{ label: 'Subagents', amount: breakdown.model.subagent, sub: true as const }] : []),
    { label: 'Browser', amount: breakdown.browser },
    { label: 'Box', amount: breakdown.box },
    { label: 'Services', amount: breakdown.services },
  ]
}

/** A month's cost by source with the total (Robot panel, Profile). */
export function CostBreakdownView({ breakdown, label }: { breakdown: CostBreakdown; label: string }) {
  return (
    <table className="cost-breakdown" aria-label={label}>
      <tbody>
        {costLines(breakdown).map((line) => (
          <tr key={line.label} className={line.sub === true ? 'cost-sub' : undefined}>
            <th scope="row">{line.label}</th>
            <td>{usd(line.amount)}</td>
          </tr>
        ))}
        <tr className="cost-total"><th scope="row">Total</th><td>{usd(breakdown.total)}</td></tr>
      </tbody>
    </table>
  )
}

/** One line for a table cell (Admin): every source that cost something. */
export function costSummary(breakdown: CostBreakdown): string {
  const parts = costLines(breakdown).filter((line) => line.sub !== true && line.amount > 0).map((line) => `${line.label.toLowerCase()} ${usd(line.amount)}`)
  return parts.length === 0 ? 'nothing yet' : parts.join(' · ')
}
