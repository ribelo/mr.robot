import { TOKENS } from '../theme/theme-css.ts'

/** A Robot's identity colour (ap-udc9): the token palette, or any colour from the system picker. A colour set earlier stays valid and shows in the picker. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const custom = !TOKENS.palette.includes(value)
  return (
    <div className="color-row" role="radiogroup" aria-label="Avatar colour">
      {TOKENS.palette.map((color) => (
        <button key={color} type="button" role="radio" aria-checked={value === color} aria-label={color} className={value === color ? 'color-dot on' : 'color-dot'} style={{ background: color }} onClick={() => onChange(color)} />
      ))}
      <label className={custom ? 'color-dot color-custom on' : 'color-dot color-custom'} style={{ background: custom ? value : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} title="Custom colour">
        <input type="color" aria-label="Custom colour" value={value} onChange={(event) => onChange(event.target.value.toLowerCase())} />
      </label>
    </div>
  )
}
