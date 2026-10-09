import { useState } from 'react'
import { TOKENS } from '../theme/theme-css.ts'

const HEX = /^#[0-9a-fA-F]{6}$/

/** A Robot's identity colour (ap-udc9): the token palette, or any hex. A colour set earlier stays valid and shows in the hex field. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState<string>()
  const text = draft ?? value
  return (
    <>
      <div className="color-row" role="radiogroup" aria-label="Avatar colour">
        {TOKENS.palette.map((color) => (
          <button key={color} type="button" role="radio" aria-checked={value === color} aria-label={color} className={value === color ? 'color-dot on' : 'color-dot'} style={{ background: color }} onClick={() => { setDraft(undefined); onChange(color) }} />
        ))}
      </div>
      <label className="color-hex">Custom colour
        <input aria-label="Custom colour" value={text} maxLength={7} spellCheck={false} aria-invalid={!HEX.test(text)}
          onChange={(event) => {
            const next = event.target.value.startsWith('#') ? event.target.value : `#${event.target.value}`
            setDraft(next)
            if (HEX.test(next)) onChange(next.toLowerCase())
          }}
          onBlur={() => setDraft(undefined)} />
      </label>
    </>
  )
}
